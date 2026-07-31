# ASIO Clean-Room Provenance

Status: lightweight personal open-source provenance record

The compatibility implementation is limited to Windows x64 system APIs and the internal ABI
contract under `audio-engine/output/asio/abi`. No SDK header, source file, binary, archive, or
vendor-private header may be added to the repository or used as implementation input.

Contract revision 2 records the public interoperability facts needed for Native DSD I/O-format
negotiation as original field and lifecycle descriptions in
`docs/legal/asio-interoperability-spec.md`. The repository retains only its independently named
contract, golden layout manifest, fake-driver behavior, and test results; it does not retain a
third-party interface file or copied implementation.

`pnpm run verify:asio-sdk-free` scans the current source tree and Git path history for prohibited
SDK directories, headers, and source files. It is a mechanical safeguard; retain its result with
the ABI manifests and hardware evidence for each experimental validation run.

For this personal open-source project, a formal owner or clean-room reviewer signature is not
required. The project owner should keep the permitted source categories, prohibited materials,
and the date for material ABI changes in this file or the related decision record. A formal
attestation and legal review become appropriate before commercialization or a hardware-partner
release.

This document is a process record, not a legal conclusion. Its absence does not waive the
engineering requirements for the compatibility backend.
