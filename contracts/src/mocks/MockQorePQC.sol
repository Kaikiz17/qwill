// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Hardhat stand-in for the real precompile. A signature is the 32-byte
/// keccak256 of the public key concatenated with the message. The testnet
/// precompile checks ML-DSA-87 instead. This mock is never deployed there.
contract MockQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool valid)
    {
        return signature.length == 32 && bytes32(signature) == keccak256(abi.encodePacked(pubkey, message));
    }
}
