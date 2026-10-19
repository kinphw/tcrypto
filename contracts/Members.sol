// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Forwarder.sol";

/// @title Members - 닉네임 명부
/// @notice 지갑 주소(0x…)와 닉네임을 1:1로 묶는다. 누구나 가입할 수 있고, 한 번 정한 닉네임은 바꿀 수 없다.
///         대납 중계(Forwarder)를 통하면 ETH 없이 서명만으로 가입할 수 있다.
/// @dev    감독 관점: 명부에는 실명이 없다(가명성).
contract Members is ERC2771Context {
    mapping(address => string) public nameOf;
    mapping(bytes32 => address) private _byName;
    address[] private _members;

    event Joined(address indexed who, string name, uint256 memberNo);

    constructor(address forwarder_) ERC2771Context(forwarder_) {}

    function join(string calldata name) external {
        address who = _msgSender();
        uint256 len = bytes(name).length;
        require(len >= 1 && len <= 30, "Members: name must be 1-30 bytes");
        require(bytes(nameOf[who]).length == 0, "Members: already joined");
        bytes32 h = keccak256(bytes(name));
        require(_byName[h] == address(0), "Members: name taken");
        _byName[h] = who;
        nameOf[who] = name;
        _members.push(who);
        emit Joined(who, name, _members.length);
    }

    function addrOf(string calldata name) external view returns (address) {
        return _byName[keccak256(bytes(name))];
    }

    function count() external view returns (uint256) {
        return _members.length;
    }

    function all() external view returns (address[] memory addrs, string[] memory names) {
        addrs = _members;
        names = new string[](addrs.length);
        for (uint256 i = 0; i < addrs.length; i++) names[i] = nameOf[addrs[i]];
    }
}
