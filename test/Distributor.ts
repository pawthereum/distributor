import { expect } from "chai";
import { ethers } from "hardhat";
import { parseEther, parseUnits } from "ethers";
import { Distributor, PancakeFactory, PancakePair, PancakeRouter, Pawthereum, WBNB } from "../typechain-types";

describe("Ditsributor", function () {
  // deploy a factory, router, wbnb, pawthereum, and distributor
  let factory: PancakeFactory;
  let router: PancakeRouter;
  let wbnb: WBNB;
  let pawthereum: Pawthereum;
  let distributor: Distributor;

  beforeEach(async function () {
    const [owner, acct1, acct2, ...accts] = await ethers.getSigners();
    // deploy wbnb
    const WBNB = await ethers.getContractFactory("WBNB");
    const wbnbDeployment = await WBNB.deploy();
    wbnb = await wbnbDeployment.waitForDeployment();
    // deploy the factory
    const Factory = await ethers.getContractFactory("PancakeFactory");
    const factoryDeployment = await Factory.deploy(owner.address);
    factory = await factoryDeployment.waitForDeployment();
    // deploy the router
    const Router = await ethers.getContractFactory("PancakeRouter");
    const routerDeployment = await Router.deploy(factory.getAddress(), wbnb.getAddress());
    router = await routerDeployment.waitForDeployment();
    // deploy pawthereum
    const Pawthereum = await ethers.getContractFactory("Pawthereum");
    const pawthereumDeployment = await Pawthereum.deploy(
      accts[5].address,
      accts[6].address,
      accts[7].address,
      router.getAddress(),
    );
    pawthereum = await pawthereumDeployment.waitForDeployment();
    // deploy the distributor
    const Distributor = await ethers.getContractFactory("Distributor");
    const distributorDeployment = await Distributor.deploy(
      acct1.address,
      acct2.address,
      pawthereum.getAddress(),
      pawthereum.getAddress(),
      router.getAddress(),
    );
    distributor = await distributorDeployment.waitForDeployment();
    // send 1 million pawthereum tokens to pawthereum
    await pawthereum.transfer(pawthereum.getAddress(), parseUnits("1000000", 9));
    // initialize the LP
    await pawthereum.initLp({
      value: parseEther("100"),
    });
    // set the liquidity fee to 2%
    await pawthereum.setLiquidityFee(200);
    // make the distributor tax exempt
    await pawthereum.setTaxless(distributor.getAddress(), true);
  });

  describe("Deployment", function () {
    it("Should set the receipients", async function () {
      const [, acct1, acct2] = await ethers.getSigners();
      expect(await distributor.recipient1()).to.equal(await acct1.address);
      expect(await distributor.recipient2()).to.equal(await acct2.address);
    });
  });

  describe("Owner only", function () {
    it("Should allow the owner to update the recipients", async function () {
      const [, acct1, , acct3] = await ethers.getSigners();
      await distributor.updateRecipients(acct1.address, acct3.address);
      expect(await distributor.recipient1()).to.equal(await acct1.address);
      expect(await distributor.recipient2()).to.equal(await acct3.address);
    });
    it("Should not allow a non-owner to update the recipients", async function () {
      const [, acct1, , acct3] = await ethers.getSigners();
      await expect(distributor.connect(acct1).updateRecipients(acct1.address, acct3.address)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
    });
    it("Should allow the owner to update the token address", async function () {
      const [, , , acct3] = await ethers.getSigners();
      await distributor.updateTokenAddress(acct3.address);
      expect(await distributor.tokenAddress()).to.equal(await acct3.address);
    });
    it("Should not allow a non-owner to update the token address", async function () {
      const [, acct1, , acct3] = await ethers.getSigners();
      await expect(distributor.connect(acct1).updateTokenAddress(acct3.address)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
    });
    it("Should allow the owner to update the router address", async function () {
      const [, , , acct3] = await ethers.getSigners();
      await distributor.updateUniswapRouter(acct3.address);
      expect(await distributor.uniswapRouter()).to.equal(await acct3.address);
    });
    it("Should not allow a non-owner to update the router address", async function () {
      const [, acct1, , acct3] = await ethers.getSigners();
      await expect(distributor.connect(acct1).updateUniswapRouter(acct3.address)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
    });
    it ("Should allow the owner to update the lp token holder address", async function () {
      const [, , , acct3] = await ethers.getSigners();
      await distributor.updateLpTokenHolder(acct3.address);
      expect(await distributor.lpTokenHolder()).to.equal(await acct3.address);
    });
    it("Should allow the owner to rescue eth", async function () {
      const [owner] = await ethers.getSigners();
      // send 9 eth to the distributor
      await owner.sendTransaction({
        to: distributor.getAddress(),
        value: parseEther("9"),
      });
      // get the balance of owner before
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.getAddress());
      // rescue the eth
      await distributor.rescueETH();
      // get the balance of owner after
      const ownerBalanceAfter = await ethers.provider.getBalance(owner.getAddress());
      // expect the owner to receive 9 eth minus the gas fees used to rescue the eth
      expect(ownerBalanceAfter - ownerBalanceBefore).to.be.closeTo(parseEther("9"), parseEther("0.01"));
    });
  });

  describe("Distribute eth", function () {
    it("Should distribute eth to the recipients", async function () {
      const [owner, acct1, acct2] = await ethers.getSigners();
      // send 9 eth to the distributor
      await owner.sendTransaction({
        to: distributor.getAddress(),
        value: parseEther("9"),
      });
      // get the balance of acct1 and acct2
      const acct1BalanceBefore = await ethers.provider.getBalance(acct1.getAddress());
      const acct2BalanceBefore = await ethers.provider.getBalance(acct2.getAddress());
      // get the reserves of pawthereum and weth in the lp before
      const pairAddress = await factory.getPair(pawthereum.getAddress(), wbnb.getAddress());
      const pair: PancakePair = await ethers.getContractAt("PancakePair", pairAddress);
      const reservesBefore = await pair.getReserves();
      // figure out which token is pawthereum and which is weth
      let tokenIndex: number;
      let wethIndex: number;
      const token0 = await pair.token0();
      const tokenAddress = await pawthereum.getAddress();
      if (token0 === tokenAddress) {
        tokenIndex = 0;
        wethIndex = 1;
      } else {
        tokenIndex = 1;
        wethIndex = 0;
      }
      // get the LP token balance of the LP token holder before
      const lpBalanceBefore = await pair.balanceOf(pawthereum.getAddress());
      // execute distribute eth
      await distributor.distributeETH();
      // fetch balances after
      const acct1BalanceAfter = await ethers.provider.getBalance(acct1.getAddress());
      const acct2BalanceAfter = await ethers.provider.getBalance(acct2.getAddress());
      // expect acct1 to receive 3 eth
      expect(acct1BalanceAfter - acct1BalanceBefore).to.equal(parseEther("3"));
      // expect acct2 to receive 3 eth
      expect(acct2BalanceAfter - acct2BalanceBefore).to.equal(parseEther("3"));
      // expect the weth reserves of pawthereum and weth pair to increase by 3 eth
      const reservesAfter = await pair.getReserves();
      expect(reservesAfter[wethIndex] - reservesBefore[wethIndex]).to.equal(parseEther("3"));
      // expect the lp token balance of the LP token holder to increase
      const lpBalanceAfter = await pair.balanceOf(pawthereum.getAddress());
      expect(lpBalanceAfter - lpBalanceBefore).to.be.greaterThan(0);
    });
  });
});