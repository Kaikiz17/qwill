// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice QoreChain testnet precompile. Active at 0x…0A01. Not active on mainnet.
interface IQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);
}
