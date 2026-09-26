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

This contract needs no other gltest WASI-mock patches: it uses only the
plain "ExecPrompt" request type (gl.nondet.exec_prompt with no
response_format="json") and gl.nondet.web.get -- both are already
handled by gltest's stock direct-mode mock via vm.mock_llm/vm.mock_web.
"""

import os

_original_unlink = os.unlink


def _tolerant_unlink(path, *args, **kwargs):
    try:
        _original_unlink(path, *args, **kwargs)
    except PermissionError:
        pass


os.unlink = _tolerant_unlink
