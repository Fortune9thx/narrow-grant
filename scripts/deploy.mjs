import fs from "node:fs";
import { ethers } from "ethers";
import { createClient, createAccount } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const KEYSTORE_PATH = process.env.NARROWGRANT_KEYSTORE_PATH;
const KEYSTORE_PASSWORD = process.env.NARROWGRANT_KEYSTORE_PASSWORD;

if (!KEYSTORE_PATH || !KEYSTORE_PASSWORD) {
  console.error("Set NARROWGRANT_KEYSTORE_PATH and NARROWGRANT_KEYSTORE_PASSWORD");
  process.exit(1);
}

const keystoreJson = fs.readFileSync(KEYSTORE_PATH, "utf-8");
const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, KEYSTORE_PASSWORD);
const privateKey = wallet.privateKey;

if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("Decrypted key has unexpected length/format, aborting.");
  process.exit(1);
}

const account = createAccount(privateKey);
if (account.address.toLowerCase() !== wallet.address.toLowerCase()) {
  console.error("Derived address mismatch, aborting.");
  process.exit(1);
}
console.log("Deployer address:", account.address);

const client = createClient({ chain: studioDevnet, account });

const balance = await client.getBalance({ address: account.address });
console.log("Balance (wei):", balance.toString());

const contractCode = fs.readFileSync("contracts/NarrowGrant.py", "utf-8");

// Cheap pre-flight: confirms the contract's own pinned runner hash resolves
// on this network BEFORE spending a real deploy transaction.
const schema = await client.getContractSchemaForCode(contractCode);
console.log("Contract schema resolved OK. Methods:", Object.keys(schema.methods ?? {}));

const fees = await client.estimateTransactionFees({});
console.log("Estimated fees:", { feeValue: fees.feeValue?.toString(), distribution: fees.distribution });

const deployTxHash = await client.deployContract({
  code: contractCode,
  args: [],
  fees,
});
console.log("Deploy tx hash:", deployTxHash);

const receipt = await client.waitForTransactionReceipt({
  hash: deployTxHash,
  waitUntil: "decided",
  retries: 60,
  interval: 5000,
});
console.log("Status:", receipt.statusName);
console.log("Execution result:", receipt.txExecutionResultName);

// For a deploy transaction, GenLayer's `to_address` IS the new contract's
// address (confirmed on this SDK build; `txDataDecoded.contractAddress` is
// not reliably populated).
const contractAddress = receipt.txDataDecoded?.contractAddress ?? receipt.to_address;
console.log("Contract address:", contractAddress);

fs.writeFileSync(
  "scripts/deployed.json",
  JSON.stringify(
    {
      network: "studioDevnet",
      deployTxHash,
      contractAddress: contractAddress ?? null,
      deployerAddress: account.address,
      statusName: receipt.statusName,
      txExecutionResultName: receipt.txExecutionResultName,
      deployedAt: new Date().toISOString(),
    },
    null,
    2
  )
);
console.log("Wrote scripts/deployed.json");
