import fs from "node:fs";
import { ethers } from "ethers";
import { createClient, createAccount } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

// Live smoke test against an already-deployed NarrowGrant contract on
// GenLayer Studio Devnet. Uses genlayer-js directly (not the `genlayer`
// CLI's `--args`) because the CLI's arg parser JSON.parses any
// JSON-shaped string argument and sends the parsed object/array instead
// of the literal string -- fatal for grant_json, a `str` parameter
// whose value is itself JSON-encoded text. Native JS args passed
// straight to genlayer-js keep their real type.

const KEYSTORE_PATH = process.env.NARROWGRANT_KEYSTORE_PATH;
const KEYSTORE_PASSWORD = process.env.NARROWGRANT_KEYSTORE_PASSWORD;
const CONTRACT_ADDRESS = process.env.NARROWGRANT_CONTRACT_ADDRESS;

if (!KEYSTORE_PATH || !KEYSTORE_PASSWORD || !CONTRACT_ADDRESS) {
  console.error("Set NARROWGRANT_KEYSTORE_PATH, NARROWGRANT_KEYSTORE_PASSWORD, NARROWGRANT_CONTRACT_ADDRESS");
  process.exit(1);
}

const keystoreJson = fs.readFileSync(KEYSTORE_PATH, "utf-8");
const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, KEYSTORE_PASSWORD);
const privateKey = wallet.privateKey;
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("Decrypted key has unexpected length/format, aborting.");
  process.exit(1);
}

const owner = createAccount(privateKey);
if (owner.address.toLowerCase() !== wallet.address.toLowerCase()) {
  console.error("Derived address mismatch, aborting.");
  process.exit(1);
}
console.log("Owner/grantor address:", owner.address);

// A second, throwaway identity for the hop's grantee -- the contract
// requires grantee != caller, and prove_use requires the caller to be
// this exact grantee.
const granteeWallet = ethers.Wallet.createRandom();
const grantee = createAccount(granteeWallet.privateKey);
console.log("Grantee address:", grantee.address);

const ownerClient = createClient({ chain: studioDevnet, account: owner });
const granteeClient = createClient({ chain: studioDevnet, account: grantee });

// Live fee-estimation (sim_estimateTransactionFees) is unreliable on
// Studio Devnet as of this date -- it silently returns a usable-looking
// but insufficient fee for some calls, which then reverts ON-CHAIN with
// FeeValueMustBeNonZero rather than failing before broadcast. A complete
// fee distribution copied from a real, recently FINALIZED transaction on
// this exact network is used unconditionally instead (the same technique
// used for this contract's own deploy).
const PROVEN_FEES = {
  feeValue: 125000000000041661n,
  distribution: {
    rotations: [1, 1],
    appealRounds: 1,
    totalMessageFees: 0,
    executionConsumed: 0,
    receiptFeeMaxGasPrice: 300000000,
    storageFeeMaxGasPrice: 300000000,
    maxPriceGenPerTimeUnit: 2,
    executionBudgetPerRound: 25000000000000000n,
    leaderTimeunitsAllocation: 125,
    validatorTimeunitsAllocation: 250,
  },
};

async function write(client, functionName, args) {
  const txHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    fees: PROVEN_FEES,
  });
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    waitUntil: "finalized",
    retries: 60,
    interval: 5000,
  });
  return { txHash, receipt };
}

async function read(functionName, args) {
  return ownerClient.readContract({ address: CONTRACT_ADDRESS, functionName, args });
}

function summarize(label, txHash, receipt) {
  console.log(`\n${label}`);
  console.log("  tx:", txHash);
  console.log("  status:", receipt.statusName, "|", receipt.txExecutionResultName);
}

const results = {};

const now = Math.floor(Date.now() / 1000);
const future = now + 60 * 60 * 24 * 30; // 30 days out

// ---------------------------------------------------------------------
// 1. issue_origin with a declared grant
// ---------------------------------------------------------------------
const originGrant = JSON.stringify({
  schema: "narrowgrant.v1",
  actions: ["pay", "refund"],
  asset: "USDC",
  cap: "1000",
  unit: "usd",
  period: "month",
  mode: "declared",
  witness_url: "",
  extract_instruction: "",
  note: "",
});

const step1 = await write(ownerClient, "issue_origin", [originGrant, true, future]);
summarize("1. issue_origin", step1.txHash, step1.receipt);
const originId = "o0"; // first-ever origin on a freshly deployed contract
const originRecord = await read("get_origin", [originId]);
console.log("  origin_id:", originId);
console.log("  get_origin ->", originRecord);
results.step1 = { tx: step1.txHash, status: step1.receipt.statusName, result: step1.receipt.txExecutionResultName, origin_id: originId, get_origin: originRecord };

// ---------------------------------------------------------------------
// 2. issue_hop that narrows cap/actions
// ---------------------------------------------------------------------
const hopGrant = JSON.stringify({
  schema: "narrowgrant.v1",
  actions: ["pay"],
  asset: "USDC",
  cap: "500",
  unit: "usd",
  period: "tx",
  mode: "declared",
  witness_url: "",
  extract_instruction: "",
  note: "",
});

const step2 = await write(ownerClient, "issue_hop", [originId, grantee.address, hopGrant, true, future]);
summarize("2. issue_hop (narrowed)", step2.txHash, step2.receipt);
const hopId = "h0";
const hopRecord = await read("get_hop", [hopId]);
console.log("  hop_id:", hopId);
console.log("  get_hop ->", hopRecord);
results.step2 = { tx: step2.txHash, status: step2.receipt.statusName, result: step2.receipt.txExecutionResultName, hop_id: hopId, get_hop: hopRecord };

// ---------------------------------------------------------------------
// 3. prove_use from the grantee
// ---------------------------------------------------------------------
const step3 = await write(granteeClient, "prove_use", [hopId, "pay", "300"]);
summarize("3. prove_use (by grantee)", step3.txHash, step3.receipt);
results.step3 = { tx: step3.txHash, status: step3.receipt.statusName, result: step3.receipt.txExecutionResultName };

// ---------------------------------------------------------------------
// 4. one rejected hop that tries to raise the cap
// ---------------------------------------------------------------------
const overCapGrant = JSON.stringify({
  schema: "narrowgrant.v1",
  actions: ["pay"],
  asset: "USDC",
  cap: "2000", // exceeds origin's 1000 cap -- must be rejected
  unit: "usd",
  period: "tx",
  mode: "declared",
  witness_url: "",
  extract_instruction: "",
  note: "",
});

let step4;
try {
  const rejected = await write(ownerClient, "issue_hop", [originId, grantee.address, overCapGrant, true, future]);
  summarize("4. issue_hop (cap increase -- expected to fail)", rejected.txHash, rejected.receipt);
  step4 = { tx: rejected.txHash, status: rejected.receipt.statusName, result: rejected.receipt.txExecutionResultName };
} catch (err) {
  console.log("\n4. issue_hop (cap increase -- expected to fail)");
  console.log("  threw as expected:", err.message ?? String(err));
  step4 = { threw: true, message: err.message ?? String(err) };
}
results.step4 = step4;

// ---------------------------------------------------------------------
// 5. (bonus) one checkable hop against a stable HTTPS witness
// ---------------------------------------------------------------------
const witnessText = "cap: 500, asset: USDC, unit: usd";
const witnessUrl = `https://httpbin.org/base64/${Buffer.from(witnessText, "utf-8").toString("base64")}`;

const grantee3Wallet = ethers.Wallet.createRandom();
const grantee3 = createAccount(grantee3Wallet.privateKey);

const checkableGrant = JSON.stringify({
  schema: "narrowgrant.v1",
  actions: ["pay"],
  asset: "USDC",
  cap: "500",
  unit: "usd",
  period: "tx",
  mode: "checkable",
  witness_url: witnessUrl,
  extract_instruction:
    "The page lists cap, asset, and unit as explicit key:value pairs separated by commas. Extract their exact values.",
  note: "",
});

let step5;
try {
  const checkable = await write(ownerClient, "issue_hop", [originId, grantee3.address, checkableGrant, true, future]);
  summarize("5. issue_hop (checkable, live witness)", checkable.txHash, checkable.receipt);
  step5 = {
    tx: checkable.txHash,
    status: checkable.receipt.statusName,
    result: checkable.receipt.txExecutionResultName,
    witness_url: witnessUrl,
  };
} catch (err) {
  console.log("\n5. issue_hop (checkable, live witness)");
  console.log("  threw:", err.message ?? String(err));
  step5 = { threw: true, message: err.message ?? String(err), witness_url: witnessUrl };
}
results.step5 = step5;

console.log("\n=== SMOKE TEST RESULTS (JSON) ===");
console.log(JSON.stringify(results, null, 2));

fs.writeFileSync("scripts/smoke-results.json", JSON.stringify(results, null, 2));
console.log("\nWrote scripts/smoke-results.json");
