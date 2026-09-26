"""
Windows compatibility shim for gltest's direct-mode message injection.

gltest.direct.loader._inject_message_to_fd0 (genlayer-test==0.29.2) does:
    os.dup2(fd, 0)   # duplicate the temp file's fd onto stdin
    os.close(fd)     # close the original fd
    os.unlink(path)  # delete the temp file

On POSIX this works because unlinking an open file just removes the
directory entry while the still-open fd (now living at fd 0) keeps the
data alive. On Windows, os.unlink refuses to remove a file that any
handle still has open -- fd 0 still points at it via dup2 -- so this
raises PermissionError (WinError 32) on every direct-mode contract deploy.

This is an upstream bug in the test library, not in the contract under
test. We patch os.unlink to swallow exactly that failure so test
collection can proceed; the OS will actually delete the temp file once
fd 0 is closed/reused at process exit.

"""

import os

_original_unlink = os.unlink


def _tolerant_unlink(path, *args, **kwargs):
    try:
        _original_unlink(path, *args, **kwargs)
    except PermissionError:
        pass


os.unlink = _tolerant_unlink


# ---------------------------------------------------------------------------
# gltest's own LLM mock always tries to json.loads() a mock_llm() response
# and, if it parses, returns the DECODED DICT instead of the literal string
# (gltest/direct/wasi_mock.py's _handle_llm_request). contracts/NarrowGrant.py's
# _run_witness_consensus calls gl.nondet.exec_prompt(prompt,
# response_format="json"), and the real SDK's own JSON-result decoder
# (genlayer.nondet._decode_nondet_json) expects the underlying nondet
# response to be raw TEXT that IT parses itself -- receiving an
# already-parsed dict from the mock fails with "JSON result is not text".
#
# This is a test-harness gap, not a contract bug -- the identical fix
# already confirmed for this class of gap on a sibling project. Patch
# _handle_llm_request to keep the literal string exec_prompt's own
# response_format="json" decoder expects, instead of auto-decoding it.
# ---------------------------------------------------------------------------

from gltest.direct import wasi_mock as _wasi_mock

_original_handle_llm_request = _wasi_mock._handle_llm_request


def _patched_handle_llm_request(vm, data):
    prompt = data.get("prompt", "")
    response = vm._match_llm_mock(prompt)
    if response is not None:
        return {"ok": response}
    return _original_handle_llm_request(vm, data)


_wasi_mock._handle_llm_request = _patched_handle_llm_request
