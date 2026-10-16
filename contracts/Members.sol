// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Members - 닉네임 명부
/// @notice 지갑 주소(0x…)는 외우기 어려우니 닉네임과 주소를 1:1로 묶어 둔다.
///         누구나 가입할 수 있고, 한 번 정한 닉네임은 바꿀 수 없다.
/// @dev    감독 관점: 명부에는 실명이 없다. 닉네임만으로는 실제 사람을 알 수 없다(가명성).
contract Members {
    mapping(address => string) public nameOf;
    mapping(bytes32 => address) private _byName;
    address[] private _members;

    event Joined(address indexed who, string name, uint256 memberNo);

    function join(string calldata name) external {
        uint256 len = bytes(name).length;
        require(len >= 1 && len <= 30, "Members: name must be 1-30 bytes");
        require(bytes(nameOf[msg.sender]).length == 0, "Members: already joined");
        bytes32 h = keccak256(bytes(name));
        require(_byName[h] == address(0), "Members: name taken");
        _byName[h] = msg.sender;
        nameOf[msg.sender] = name;
        _members.push(msg.sender);
        emit Joined(msg.sender, name, _members.length);
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
