// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IQorePQC.sol";

/// @title QWILL registry
/// @notice The chain record of a will. The letter is stored locked. The founder key is stored
/// locked behind a password. Neither can be read from the contract alone.
/// Check-in, cancel, and claim each rebuild the signed message and call pqcVerify.
/// There is no path that accepts an ordinary signature instead.
/// QoreX opens the EVM window from its own screens. A website cannot send that message.
contract QwillRegistry {
    IQorePQC public constant PQC = IQorePQC(0x0000000000000000000000000000000000000a01);

    uint256 public constant DSA_LEN = 2592;
    uint64 public constant MIN_INTERVAL = 3_600_000;
    uint64 public constant MAX_INTERVAL = 31_622_400_000;
    uint256 public constant SKEW = 300_000;
    uint256 public constant MAX_BLOB = 96_000;

    struct Will {
        address registrar;
        bytes32 founderHash;
        uint64 createdAt;
        uint64 intervalMs;
        uint64 lastBeat;
        uint64 cancelledAt;
        uint8 threshold;
        uint8 heirCount;
        uint8 claimCount;
        bool cancelled;
        bool opened;
        bool exists;
    }

    mapping(bytes32 => Will) private _wills;
    mapping(bytes32 => string[]) private _heirIds;
    mapping(bytes32 => bytes32) private _heirHash;
    mapping(bytes32 => bool) private _heirUsed;
    mapping(bytes32 => bytes) private _letter;
    mapping(bytes32 => bytes) private _vault;
    mapping(address => string[]) private _byWallet;

    event WillSealed(bytes32 indexed willKey, address indexed registrar, uint64 intervalMs, uint8 threshold);
    event WillBeat(bytes32 indexed willKey, uint64 at);
    event WillCancelled(bytes32 indexed willKey, uint64 at);
    event WillClaim(bytes32 indexed willKey, uint8 count, bool opened);

    error Unknown();
    error Exists();
    error BadId();
    error Heirs();
    error Interval();
    error Time();
    error Key();
    error Signature();
    error Quiet();
    error Done();
    error Heir();
    error Empty();
    error Huge();

    function seal(
        string calldata willId,
        uint64 recordedAt,
        uint64 intervalMs,
        uint8 threshold,
        string[] calldata heirIds,
        bytes[] calldata heirKeys,
        bytes calldata founderKey,
        bytes calldata signature,
        bytes calldata letter,
        bytes calldata vault
    ) external {
        bytes32 willKey = _id(willId);
        if (_wills[willKey].exists) revert Exists();
        uint256 count = heirIds.length;
        if (count < 2 || count > 5 || heirKeys.length != count) revert Heirs();
        if (threshold < 2 || threshold > count) revert Heirs();
        if (intervalMs < MIN_INTERVAL || intervalMs > MAX_INTERVAL) revert Interval();
        if (letter.length == 0 || vault.length == 0) revert Empty();
        if (letter.length > MAX_BLOB || vault.length > MAX_BLOB) revert Huge();
        _near(recordedAt);

        bytes memory message = previewSeal(
            willId,
            recordedAt,
            intervalMs,
            threshold,
            heirIds,
            heirKeys,
            founderKey,
            letter,
            vault
        );
        _requirePq(founderKey, signature, message);

        Will storage will = _wills[willKey];
        will.registrar = msg.sender;
        will.founderHash = keccak256(founderKey);
        will.createdAt = recordedAt;
        will.intervalMs = intervalMs;
        will.lastBeat = recordedAt;
        will.threshold = threshold;
        will.heirCount = uint8(count);
        will.exists = true;

        for (uint256 i = 0; i < count; i++) {
            _checkId(heirIds[i]);
            if (heirKeys[i].length != DSA_LEN) revert Key();
            for (uint256 j = 0; j < i; j++) {
                if (keccak256(bytes(heirIds[i])) == keccak256(bytes(heirIds[j]))) revert Heirs();
            }
            bytes32 slot = _slot(willKey, heirIds[i]);
            _heirHash[slot] = keccak256(heirKeys[i]);
            _heirIds[willKey].push(heirIds[i]);
        }

        _letter[willKey] = letter;
        _vault[willKey] = vault;
        _byWallet[msg.sender].push(willId);

        emit WillSealed(willKey, msg.sender, intervalMs, threshold);
    }

    function checkIn(string calldata willId, uint64 at, bytes calldata founderKey, bytes calldata signature) external {
        Will storage will = _existing(willId);
        if (will.cancelled) revert Done();
        if (at <= will.lastBeat) revert Time();
        _near(at);
        if (keccak256(founderKey) != will.founderHash) revert Key();
        _requirePq(founderKey, signature, previewBeat(willId, at));

        will.lastBeat = at;
        will.claimCount = 0;
        will.opened = false;
        _clearClaims(_id(willId));
        emit WillBeat(_id(willId), at);
    }

    function cancel(string calldata willId, uint64 at, bytes calldata founderKey, bytes calldata signature) external {
        Will storage will = _existing(willId);
        if (will.cancelled) revert Done();
        _near(at);
        if (keccak256(founderKey) != will.founderHash) revert Key();
        _requirePq(founderKey, signature, previewVeto(willId, at));

        will.cancelled = true;
        will.cancelledAt = at;
        emit WillCancelled(_id(willId), at);
    }

    function claim(
        string calldata willId,
        string calldata heirId,
        uint64 at,
        bytes calldata heirKey,
        bytes calldata signature
    ) external {
        Will storage will = _existing(willId);
        if (will.cancelled) revert Done();
        if (nowMs() < uint256(will.lastBeat) + uint256(will.intervalMs)) revert Quiet();
        _near(at);

        bytes32 willKey = _id(willId);
        bytes32 slot = _slot(willKey, heirId);
        bytes32 expected = _heirHash[slot];
        if (expected == bytes32(0) || keccak256(heirKey) != expected) revert Heir();
        if (_heirUsed[slot]) revert Heir();
        _requirePq(heirKey, signature, previewClaim(willId, heirId, at));

        _heirUsed[slot] = true;
        will.claimCount += 1;
        if (will.claimCount >= will.threshold) will.opened = true;
        emit WillClaim(willKey, will.claimCount, will.opened);
    }

    function read(string calldata willId)
        external
        view
        returns (
            bool exists,
            address registrar,
            bytes32 founderHash,
            uint64 createdAt,
            uint64 intervalMs,
            uint64 lastBeat,
            uint64 cancelledAt,
            uint8 threshold,
            uint8 heirCount,
            uint8 claimCount,
            bool cancelled,
            bool opened,
            bool claimable
        )
    {
        Will storage will = _wills[_id(willId)];
        exists = will.exists;
        if (!exists) return (false, address(0), 0, 0, 0, 0, 0, 0, 0, 0, false, false, false);
        registrar = will.registrar;
        founderHash = will.founderHash;
        createdAt = will.createdAt;
        intervalMs = will.intervalMs;
        lastBeat = will.lastBeat;
        cancelledAt = will.cancelledAt;
        threshold = will.threshold;
        heirCount = will.heirCount;
        claimCount = will.claimCount;
        cancelled = will.cancelled;
        opened = will.opened;
        claimable = !cancelled && nowMs() >= uint256(lastBeat) + uint256(intervalMs);
    }

    function willsOf(address wallet) external view returns (string[] memory) {
        return _byWallet[wallet];
    }

    function letterOf(string calldata willId) external view returns (bytes memory) {
        return _letter[_id(willId)];
    }

    function vaultOf(string calldata willId) external view returns (bytes memory) {
        return _vault[_id(willId)];
    }

    function keyHashHex(bytes calldata key) external pure returns (string memory) {
        return _hex(keccak256(key));
    }

    function previewBeat(string memory willId, uint64 at) public pure returns (bytes memory) {
        _checkId(willId);
        return bytes(string.concat("action=beat\nat=", _dec(at), "\nv=1\nwill=", willId));
    }

    function previewVeto(string memory willId, uint64 at) public pure returns (bytes memory) {
        _checkId(willId);
        return bytes(string.concat("action=veto\nat=", _dec(at), "\nv=1\nwill=", willId));
    }

    function previewClaim(string memory willId, string memory heirId, uint64 at) public pure returns (bytes memory) {
        _checkId(willId);
        _checkId(heirId);
        return bytes(string.concat("action=claim\nat=", _dec(at), "\nheir=", heirId, "\nv=1\nwill=", willId));
    }

    function previewSeal(
        string memory willId,
        uint64 recordedAt,
        uint64 intervalMs,
        uint8 threshold,
        string[] memory heirIds,
        bytes[] memory heirKeys,
        bytes memory founderKey,
        bytes memory letter,
        bytes memory vault
    ) public pure returns (bytes memory) {
        _checkId(willId);
        if (founderKey.length != DSA_LEN) revert Key();
        if (letter.length == 0 || vault.length == 0) revert Empty();
        return bytes(
            string.concat(
                "action=seal\nat=",
                _dec(recordedAt),
                "\nheirs=",
                _heirs(heirIds, heirKeys),
                "\ninterval=",
                _dec(intervalMs),
                "\npacket=",
                _hex(keccak256(letter)),
                "\nthreshold=",
                _dec(threshold),
                "\nv=1\nvault=",
                _hex(keccak256(vault)),
                "\nwill=",
                willId
            )
        );
    }

    function _requirePq(bytes memory pubkey, bytes calldata signature, bytes memory message) internal view {
        if (pubkey.length != DSA_LEN) revert Key();
        if (signature.length == 0) revert Signature();
        if (!PQC.pqcVerify(pubkey, signature, message)) revert Signature();
    }

    function _existing(string calldata willId) internal view returns (Will storage will) {
        will = _wills[_id(willId)];
        if (!will.exists) revert Unknown();
    }

    function _clearClaims(bytes32 willKey) internal {
        string[] storage ids = _heirIds[willKey];
        for (uint256 i = 0; i < ids.length; i++) {
            _heirUsed[_slot(willKey, ids[i])] = false;
        }
    }

    function _near(uint64 at) internal view {
        uint256 clock = nowMs();
        if (uint256(at) + SKEW < clock || uint256(at) > clock + SKEW) revert Time();
    }

    function nowMs() public view returns (uint256) {
        return uint256(block.timestamp) * 1000;
    }

    function _id(string memory willId) internal pure returns (bytes32) {
        _checkId(willId);
        return keccak256(bytes(willId));
    }

    function _slot(bytes32 willKey, string memory heirId) internal pure returns (bytes32) {
        return keccak256(abi.encode(willKey, heirId));
    }

    function _checkId(string memory id) internal pure {
        bytes memory raw = bytes(id);
        if (raw.length == 0 || raw.length > 80) revert BadId();
        for (uint256 i = 0; i < raw.length; i++) {
            bytes1 c = raw[i];
            bool ok = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c == 0x2d;
            if (!ok) revert BadId();
        }
    }

    function _heirs(string[] memory ids, bytes[] memory keys) internal pure returns (string memory out) {
        if (ids.length != keys.length || ids.length == 0) revert Heirs();
        for (uint256 i = 0; i < ids.length; i++) {
            _checkId(ids[i]);
            if (keys[i].length != DSA_LEN) revert Key();
            string memory piece = string.concat(ids[i], ":", _hex(keccak256(keys[i])));
            out = i == 0 ? piece : string.concat(out, ",", piece);
        }
    }

    function _dec(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _hex(bytes32 data) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            str[i * 2] = alphabet[uint8(data[i] >> 4)];
            str[1 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }
}
