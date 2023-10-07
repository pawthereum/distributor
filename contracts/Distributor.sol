// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

interface IUniswapV2Router {
    function WETH() external pure returns (address);
    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity);
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable;
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
    function factory() external view returns (address);
}

interface IUniswapFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        // On the first call to nonReentrant, _notEntered will be true
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");

        // Any calls to nonReentrant after this point will fail
        _status = _ENTERED;

        _;

        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = _NOT_ENTERED;
    }
}

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
}

abstract contract Ownable is Context {
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        _transferOwnership(_msgSender());
    }

    function owner() public view virtual returns (address) {
        return _owner;
    }

    modifier onlyOwner() {
        require(owner() == _msgSender(), "Ownable: caller is not the owner");
        _;
    }

    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        _transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

contract Distributor is Ownable, ReentrancyGuard {
    address payable public recipient1;
    address payable public recipient2;
    address public tokenAddress;
    address public lpTokenHolder;
    IUniswapV2Router public uniswapRouter;

    constructor(
        address payable _recipient1,
        address payable _recipient2,
        address _tokenAddress,
        address _lpTokenHolder,
        address _uniswapRouter
    ) {
        recipient1 = _recipient1;
        recipient2 = _recipient2;
        tokenAddress = _tokenAddress;
        lpTokenHolder = _lpTokenHolder;
        uniswapRouter = IUniswapV2Router(_uniswapRouter);
    }

    receive() external payable {}

    function distributeETH() external nonReentrant {
        require(address(this).balance > 0, "No ETH balance in the contract");

        uint256 oneThird = address(this).balance / 3;

        // Send 1/3 to recipient1 and recipient2 using .call
        (bool success1,) = recipient1.call{value: oneThird}("");
        require(success1, "Transfer to recipient1 failed");
        
        (bool success2,) = recipient2.call{value: oneThird}("");
        require(success2, "Transfer to recipient2 failed");

        // Swap half of the remaining for the specified token
        address[] memory path = new address[](2);
        path[0] = uniswapRouter.WETH();
        path[1] = tokenAddress;
        
        uint256 remainingForSwap = oneThird / 2;
        
        // Get a quote for the swap
        uint256[] memory expectedAmounts = uniswapRouter.getAmountsOut(remainingForSwap, path);
        uint256 minimumAmount = (expectedAmounts[1] * 90) / 100; // 90% of the expected amount to allow 10% deviation
        
        uint256 initialTokenBalance = IERC20(tokenAddress).balanceOf(address(this));
        uniswapRouter.swapExactETHForTokensSupportingFeeOnTransferTokens{value: remainingForSwap}(minimumAmount, path, address(this), block.timestamp + 1 minutes);
        uint256 newTokenBalance = IERC20(tokenAddress).balanceOf(address(this));

        // Calculate the exact token amount received from the swap
        uint256 tokensFromSwap = newTokenBalance - initialTokenBalance;

        // Now, add liquidity for the remaining ETH and tokens received from the swap
        IERC20(tokenAddress).approve(address(uniswapRouter), tokensFromSwap);
        uniswapRouter.addLiquidityETH{value: remainingForSwap}(tokenAddress, tokensFromSwap, 0, 0, address(this), block.timestamp + 1 minutes);
        
        // Get the pair address of the token and WETH (aka LP token)
        address lpToken = IUniswapFactory(uniswapRouter.factory()).getPair(tokenAddress, uniswapRouter.WETH());
        // Send the LP tokens to the LP token holder
        IERC20(lpToken).transfer(lpTokenHolder, IERC20(lpToken).balanceOf(address(this)));
    }

    // if tokens are sent here inadvertendly, rescue them
    function rescueTokens(uint256 _amount, address _token) external onlyOwner {
        require(IERC20(_token).balanceOf(address(this)) >= _amount, "Insufficient token balance");
        IERC20(_token).approve(msg.sender, _amount);
        IERC20(_token).transfer(msg.sender, _amount);
    }

    // if ETH is sent here inadvertendly, rescue it
    function rescueETH() external onlyOwner {
        require(address(this).balance > 0, "No ETH balance in the contract");
        // transfer all ETH to owner
        (bool success,) = msg.sender.call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }

    // allow owner to update recipients
    function updateRecipients(address payable _recipient1, address payable _recipient2) external onlyOwner {
        recipient1 = _recipient1;
        recipient2 = _recipient2;
    }
    // allow owner to update uni router
    function updateUniswapRouter(address _uniswapRouter) external onlyOwner {
        uniswapRouter = IUniswapV2Router(_uniswapRouter);
    }
    // allow owner to update the lp token holder
    function updateLpTokenHolder(address _lpTokenHolder) external onlyOwner {
        lpTokenHolder = _lpTokenHolder;
    }
    // allow owner to update token address
    function updateTokenAddress(address _tokenAddress) external onlyOwner {
        tokenAddress = _tokenAddress;
    }
}