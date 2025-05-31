import { describe, expect, it } from "vitest";

// Mock Clarity contract interaction
const mockContract = {
  // Contract state
  state: {
    nextPositionId: 1,
    protocolFeeRate: 50, // 0.5%
    liquidationThreshold: 8000, // 80%
    marketOpen: true,
    commodities: new Map(),
    positions: new Map(),
    userBalances: new Map(),
    commodityStats: new Map(),
    oracleFeeds: new Map(),
    tokenBalances: new Map()
  },

  // Constants
  GOLD: 1,
  OIL: 2,
  WHEAT: 3,
  CORN: 4,

  // Helper functions
  generateKey: (user, commodityId) => `${user}-${commodityId}`,
  
  // Contract functions
  initializeCommodity: function(commodityId, name, symbol, unit, initialPrice, marginRequirement, contractSize) {
    if (marginRequirement > 5000) throw new Error("ERR-INVALID-AMOUNT");
    
    this.state.commodities.set(commodityId, {
      name,
      symbol,
      unit,
      price: initialPrice,
      lastUpdated: Date.now(),
      dailyChange: 0,
      volatility: 1000,
      marginRequirement,
      contractSize,
      active: true
    });

    this.state.commodityStats.set(commodityId, {
      totalLongPositions: 0,
      totalShortPositions: 0,
      totalVolume24h: 0,
      openInterest: 0,
      fundingRate: 0
    });

    return { ok: true };
  },

  registerOracle: function(commodityId, oracleAddress) {
    this.state.oracleFeeds.set(commodityId, {
      oracleAddress,
      lastPrice: 0,
      lastUpdate: 0,
      priceConfidence: 9500,
      active: true
    });
    return { ok: true };
  },

  updatePrice: function(commodityId, newPrice, confidence, caller) {
    const commodity = this.state.commodities.get(commodityId);
    const oracle = this.state.oracleFeeds.get(commodityId);
    
    if (!commodity || !oracle) throw new Error("ERR-NOT-FOUND");
    if (caller !== oracle.oracleAddress) throw new Error("ERR-UNAUTHORIZED");
    if (confidence < 8000) throw new Error("ERR-ORACLE-STALE");

    const oldPrice = commodity.price;
    const priceChange = Math.abs(newPrice - oldPrice);
    const dailyChangePct = oldPrice > 0 ? Math.floor((priceChange * 10000) / oldPrice) : 0;

    commodity.price = newPrice;
    commodity.lastUpdated = Date.now();
    commodity.dailyChange = newPrice >= oldPrice ? dailyChangePct : -dailyChangePct;

    oracle.lastPrice = newPrice;
    oracle.lastUpdate = Date.now();
    oracle.priceConfidence = confidence;

    return { ok: true };
  },

  calculateMarginRequirement: function(commodityId, quantity) {
    const commodity = this.state.commodities.get(commodityId);
    if (!commodity) return { err: 0 };
    
    return { 
      ok: Math.floor((quantity * commodity.price * commodity.marginRequirement) / 10000) 
    };
  },

  buyCommodityTokens: function(commodityId, stxAmount, user) {
    if (!this.state.marketOpen) throw new Error("ERR-MARKET-CLOSED");
    
    const commodity = this.state.commodities.get(commodityId);
    if (!commodity || !commodity.active) throw new Error("ERR-INVALID-COMMODITY");
    if (stxAmount <= 0) throw new Error("ERR-INVALID-AMOUNT");

    const feeAmount = Math.floor((stxAmount * this.state.protocolFeeRate) / 10000);
    const netAmount = stxAmount - feeAmount;
    const tokenAmount = Math.floor(netAmount / commodity.price);

    const balanceKey = this.generateKey(user, commodityId);
    const currentBalance = this.state.userBalances.get(balanceKey) || {
      tokenBalance: 0,
      totalPositions: 0,
      realizedPnl: 0,
      marginLocked: 0
    };

    // Update token balance
    const tokenKey = this.generateKey(user, commodityId);
    const currentTokenBalance = this.state.tokenBalances.get(tokenKey) || 0;
    this.state.tokenBalances.set(tokenKey, currentTokenBalance + tokenAmount);

    currentBalance.tokenBalance += tokenAmount;
    this.state.userBalances.set(balanceKey, currentBalance);

    return { ok: tokenAmount };
  },

  sellCommodityTokens: function(commodityId, tokenAmount, user) {
    if (!this.state.marketOpen) throw new Error("ERR-MARKET-CLOSED");
    
    const commodity = this.state.commodities.get(commodityId);
    if (!commodity || !commodity.active) throw new Error("ERR-INVALID-COMMODITY");

    const balanceKey = this.generateKey(user, commodityId);
    const currentBalance = this.state.userBalances.get(balanceKey);
    if (!currentBalance || currentBalance.tokenBalance < tokenAmount) {
      throw new Error("ERR-INSUFFICIENT-BALANCE");
    }

    const stxValue = tokenAmount * commodity.price;
    const feeAmount = Math.floor((stxValue * this.state.protocolFeeRate) / 10000);
    const netProceeds = stxValue - feeAmount;

    // Update token balance
    const tokenKey = this.generateKey(user, commodityId);
    const currentTokenBalance = this.state.tokenBalances.get(tokenKey);
    this.state.tokenBalances.set(tokenKey, currentTokenBalance - tokenAmount);

    currentBalance.tokenBalance -= tokenAmount;
    this.state.userBalances.set(balanceKey, currentBalance);

    return { ok: netProceeds };
  },

  openPosition: function(commodityId, positionType, quantity, expiryBlocks, user) {
    if (!this.state.marketOpen) throw new Error("ERR-MARKET-CLOSED");
    
    const commodity = this.state.commodities.get(commodityId);
    if (!commodity || !commodity.active) throw new Error("ERR-INVALID-COMMODITY");
    if (positionType !== "long" && positionType !== "short") throw new Error("ERR-INVALID-AMOUNT");
    if (quantity <= 0) throw new Error("ERR-INVALID-AMOUNT");

    const marginResult = this.calculateMarginRequirement(commodityId, quantity);
    if (marginResult.err !== undefined) throw new Error("ERR-MARGIN-INSUFFICIENT");
    const marginRequired = marginResult.ok;

    const positionId = this.state.nextPositionId++;
    const currentPrice = commodity.price;

    this.state.positions.set(positionId, {
      user,
      commodityId,
      positionType,
      quantity,
      entryPrice: currentPrice,
      currentPrice,
      marginDeposited: marginRequired,
      unrealizedPnl: 0,
      createdAt: Date.now(),
      expiry: expiryBlocks,
      liquidated: false
    });

    // Update user balance
    const balanceKey = this.generateKey(user, commodityId);
    const currentBalance = this.state.userBalances.get(balanceKey) || {
      tokenBalance: 0,
      totalPositions: 0,
      realizedPnl: 0,
      marginLocked: 0
    };

    currentBalance.totalPositions += 1;
    currentBalance.marginLocked += marginRequired;
    this.state.userBalances.set(balanceKey, currentBalance);

    // Update commodity stats
    const stats = this.state.commodityStats.get(commodityId);
    if (positionType === "long") {
      stats.totalLongPositions += quantity;
    } else {
      stats.totalShortPositions += quantity;
    }
    stats.totalVolume24h += quantity;
    stats.openInterest += quantity;

    return { ok: positionId };
  },

  calculatePositionValue: function(positionId) {
    const position = this.state.positions.get(positionId);
    if (!position) return { err: 0 };

    const commodity = this.state.commodities.get(position.commodityId);
    if (!commodity) return { err: 0 };

    const currentPrice = commodity.price;
    const entryPrice = position.entryPrice;
    const quantity = position.quantity;

    let pnl;
    if (position.positionType === "long") {
      pnl = quantity * (currentPrice - entryPrice);
    } else {
      pnl = quantity * (entryPrice - currentPrice);
    }

    return { ok: pnl };
  },

  closePosition: function(positionId, user) {
    const position = this.state.positions.get(positionId);
    if (!position) throw new Error("ERR-NOT-FOUND");
    if (position.user !== user) throw new Error("ERR-UNAUTHORIZED");
    if (position.liquidated) throw new Error("ERR-LIQUIDATION-THRESHOLD");
    if (!this.state.marketOpen) throw new Error("ERR-MARKET-CLOSED");

    const pnlResult = this.calculatePositionValue(positionId);
    const pnl = pnlResult.ok;
    const marginRefund = position.marginDeposited;
    const settlementAmount = Math.max(0, marginRefund + pnl);

    // Update position
    position.liquidated = true;
    position.unrealizedPnl = pnl;

    // Update user balance
    const balanceKey = this.generateKey(user, position.commodityId);
    const currentBalance = this.state.userBalances.get(balanceKey);
    currentBalance.totalPositions -= 1;
    currentBalance.realizedPnl += pnl;
    currentBalance.marginLocked -= marginRefund;

    // Update commodity stats
    const stats = this.state.commodityStats.get(position.commodityId);
    if (position.positionType === "long") {
      stats.totalLongPositions -= position.quantity;
    } else {
      stats.totalShortPositions -= position.quantity;
    }
    stats.openInterest -= position.quantity;

    return { ok: settlementAmount };
  },

  getCommodityTokenBalance: function(user, commodityId) {
    const tokenKey = this.generateKey(user, commodityId);
    return this.state.tokenBalances.get(tokenKey) || 0;
  },

  getUserBalance: function(user, commodityId) {
    const balanceKey = this.generateKey(user, commodityId);
    return this.state.userBalances.get(balanceKey);
  },

  getPosition: function(positionId) {
    return this.state.positions.get(positionId);
  },

  getCommodity: function(commodityId) {
    return this.state.commodities.get(commodityId);
  }
};

describe("Commodity Futures Tokenization Protocol", () => {
  describe("Contract Initialization", () => {
    it("should initialize a commodity with valid parameters", () => {
      const result = mockContract.initializeCommodity(
        mockContract.GOLD,
        "Gold Futures",
        "GOLD",
        "troy oz",
        2000000000, // $2000 in micro-units
        2000, // 20% margin requirement
        100 // contract size
      );

      expect(result.ok).toBe(true);
      
      const commodity = mockContract.getCommodity(mockContract.GOLD);
      expect(commodity.name).toBe("Gold Futures");
      expect(commodity.symbol).toBe("GOLD");
      expect(commodity.price).toBe(2000000000);
      expect(commodity.marginRequirement).toBe(2000);
      expect(commodity.active).toBe(true);
    });

    it("should reject commodity initialization with excessive margin requirement", () => {
      expect(() => {
        mockContract.initializeCommodity(
          mockContract.OIL,
          "Oil Futures",
          "OIL",
          "barrel",
          80000000, // $80
          6000, // 60% margin - too high
          1000
        );
      }).toThrow("ERR-INVALID-AMOUNT");
    });

    it("should register oracle successfully", () => {
      const oracleAddress = "oracle-principal-1";
      const result = mockContract.registerOracle(mockContract.GOLD, oracleAddress);
      
      expect(result.ok).toBe(true);
      
      const oracle = mockContract.state.oracleFeeds.get(mockContract.GOLD);
      expect(oracle.oracleAddress).toBe(oracleAddress);
      expect(oracle.active).toBe(true);
      expect(oracle.priceConfidence).toBe(9500);
    });
  });

  describe("Price Oracle Updates", () => {
    it("should update commodity price with valid oracle", () => {
      // Setup
      const oracleAddress = "oracle-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      mockContract.registerOracle(mockContract.GOLD, oracleAddress);

      const newPrice = 2100000000; // $2100
      const confidence = 9000; // 90%

      const result = mockContract.updatePrice(mockContract.GOLD, newPrice, confidence, oracleAddress);
      
      expect(result.ok).toBe(true);
      
      const commodity = mockContract.getCommodity(mockContract.GOLD);
      expect(commodity.price).toBe(newPrice);
      expect(commodity.dailyChange).toBeGreaterThan(0); // Price increased
    });

    it("should reject price update from unauthorized oracle", () => {
      const oracleAddress = "oracle-principal-1";
      const unauthorizedOracle = "fake-oracle";
      
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      mockContract.registerOracle(mockContract.GOLD, oracleAddress);

      expect(() => {
        mockContract.updatePrice(mockContract.GOLD, 2100000000, 9000, unauthorizedOracle);
      }).toThrow("ERR-UNAUTHORIZED");
    });

    it("should reject price update with low confidence", () => {
      const oracleAddress = "oracle-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      mockContract.registerOracle(mockContract.GOLD, oracleAddress);

      expect(() => {
        mockContract.updatePrice(mockContract.GOLD, 2100000000, 7000, oracleAddress); // 70% confidence - too low
      }).toThrow("ERR-ORACLE-STALE");
    });
  });

  describe("Commodity Token Trading", () => {
    it("should allow buying commodity tokens", () => {
      // Setup
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      const stxAmount = 10000000000; // 10,000 STX (in micro-STX)
      const result = mockContract.buyCommodityTokens(mockContract.GOLD, stxAmount, user);
      
      expect(result.ok).toBeGreaterThan(0);
      
      const tokenBalance = mockContract.getCommodityTokenBalance(user, mockContract.GOLD);
      expect(tokenBalance).toBeGreaterThan(0);
      
      const userBalance = mockContract.getUserBalance(user, mockContract.GOLD);
      expect(userBalance.tokenBalance).toBe(tokenBalance);
    });

    it("should calculate protocol fees correctly when buying tokens", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 1000000000, 2000, 100); // $1000 per token
      
      const stxAmount = 1000000000; // 1000 STX
      const expectedFee = Math.floor((stxAmount * 50) / 10000); // 0.5% fee
      const expectedNetAmount = stxAmount - expectedFee;
      const expectedTokens = Math.floor(expectedNetAmount / 1000000000);
      
      const result = mockContract.buyCommodityTokens(mockContract.GOLD, stxAmount, user);
      
      expect(result.ok).toBe(expectedTokens);
    });

    it("should allow selling commodity tokens", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      // First buy some tokens
      const stxAmount = 10000000000;
      mockContract.buyCommodityTokens(mockContract.GOLD, stxAmount, user);
      
      const initialTokenBalance = mockContract.getCommodityTokenBalance(user, mockContract.GOLD);
      const tokensToSell = Math.floor(initialTokenBalance / 2);
      
      const result = mockContract.sellCommodityTokens(mockContract.GOLD, tokensToSell, user);
      
      expect(result.ok).toBeGreaterThan(0);
      
      const finalTokenBalance = mockContract.getCommodityTokenBalance(user, mockContract.GOLD);
      expect(finalTokenBalance).toBe(initialTokenBalance - tokensToSell);
    });

    it("should reject selling more tokens than balance", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      // Try to sell tokens without buying any
      expect(() => {
        mockContract.sellCommodityTokens(mockContract.GOLD, 100, user);
      }).toThrow("ERR-INSUFFICIENT-BALANCE");
    });

    it("should reject trading when market is closed", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      // Close market
      mockContract.state.marketOpen = false;
      
      expect(() => {
        mockContract.buyCommodityTokens(mockContract.GOLD, 1000000000, user);
      }).toThrow("ERR-MARKET-CLOSED");
      
      expect(() => {
        mockContract.sellCommodityTokens(mockContract.GOLD, 100, user);
      }).toThrow("ERR-MARKET-CLOSED");
      
      // Restore market state
      mockContract.state.marketOpen = true;
    });
  });

  describe("Futures Positions", () => {
    it("should allow opening a long position", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      const quantity = 10;
      const expiryBlocks = Date.now() + 86400000; // 24 hours from now
      
      const result = mockContract.openPosition(mockContract.GOLD, "long", quantity, expiryBlocks, user);
      
      expect(result.ok).toBeGreaterThan(0);
      
      const positionId = result.ok;
      const position = mockContract.getPosition(positionId);
      
      expect(position.user).toBe(user);
      expect(position.commodityId).toBe(mockContract.GOLD);
      expect(position.positionType).toBe("long");
      expect(position.quantity).toBe(quantity);
      expect(position.liquidated).toBe(false);
    });

    it("should allow opening a short position", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      const quantity = 5;
      const expiryBlocks = Date.now() + 86400000;
      
      const result = mockContract.openPosition(mockContract.GOLD, "short", quantity, expiryBlocks, user);
      
      expect(result.ok).toBeGreaterThan(0);
      
      const position = mockContract.getPosition(result.ok);
      expect(position.positionType).toBe("short");
    });

    it("should calculate margin requirement correctly", () => {
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100); // 20% margin
      
      const quantity = 10;
      const result = mockContract.calculateMarginRequirement(mockContract.GOLD, quantity);
      
      const expectedMargin = Math.floor((quantity * 2000000000 * 2000) / 10000);
      expect(result.ok).toBe(expectedMargin);
    });

    it("should update commodity stats when opening positions", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      const quantity = 10;
      const expiryBlocks = Date.now() + 86400000;
      
      mockContract.openPosition(mockContract.GOLD, "long", quantity, expiryBlocks, user);
      
      const stats = mockContract.state.commodityStats.get(mockContract.GOLD);
      expect(stats.totalLongPositions).toBe(quantity);
      expect(stats.openInterest).toBe(quantity);
      expect(stats.totalVolume24h).toBe(quantity);
    });

    it("should reject invalid position types", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      expect(() => {
        mockContract.openPosition(mockContract.GOLD, "invalid", 10, Date.now() + 86400000, user);
      }).toThrow("ERR-INVALID-AMOUNT");
    });
  });

  describe("Position Management", () => {
    it("should calculate position value correctly for long position", () => {
      const user = "user-principal-1";
      const oracleAddress = "oracle-principal-1";
      
      // Setup
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      mockContract.registerOracle(mockContract.GOLD, oracleAddress);
      
      // Open long position
      const quantity = 10;
      const positionResult = mockContract.openPosition(mockContract.GOLD, "long", quantity, Date.now() + 86400000, user);
      const positionId = positionResult.ok;
      
      // Update price to higher value
      mockContract.updatePrice(mockContract.GOLD, 2100000000, 9000, oracleAddress); // $2100
      
      const pnlResult = mockContract.calculatePositionValue(positionId);
      const expectedPnl = quantity * (2100000000 - 2000000000); // quantity * (new_price - entry_price)
      
      expect(pnlResult.ok).toBe(expectedPnl);
    });

    it("should calculate position value correctly for short position", () => {
      const user = "user-principal-1";
      const oracleAddress = "oracle-principal-1";
      
      // Setup
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      mockContract.registerOracle(mockContract.GOLD, oracleAddress);
      
      // Open short position
      const quantity = 5;
      const positionResult = mockContract.openPosition(mockContract.GOLD, "short", quantity, Date.now() + 86400000, user);
      const positionId = positionResult.ok;
      
      // Update price to lower value (profit for short)
      mockContract.updatePrice(mockContract.GOLD, 1900000000, 9000, oracleAddress); // $1900
      
      const pnlResult = mockContract.calculatePositionValue(positionId);
      const expectedPnl = quantity * (2000000000 - 1900000000); // quantity * (entry_price - new_price)
      
      expect(pnlResult.ok).toBe(expectedPnl);
    });

    it("should allow closing a profitable position", () => {
      const user = "user-principal-1";
      const oracleAddress = "oracle-principal-1";
      
      // Setup
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      mockContract.registerOracle(mockContract.GOLD, oracleAddress);
      
      // Open position
      const positionResult = mockContract.openPosition(mockContract.GOLD, "long", 10, Date.now() + 86400000, user);
      const positionId = positionResult.ok;
      
      // Update price favorably
      mockContract.updatePrice(mockContract.GOLD, 2100000000, 9000, oracleAddress);
      
      const closeResult = mockContract.closePosition(positionId, user);
      
      expect(closeResult.ok).toBeGreaterThan(0);
      
      const position = mockContract.getPosition(positionId);
      expect(position.liquidated).toBe(true);
      
      const userBalance = mockContract.getUserBalance(user, mockContract.GOLD);
      expect(userBalance.realizedPnl).toBeGreaterThan(0);
    });

    it("should prevent unauthorized position closure", () => {
      const user1 = "user-principal-1";
      const user2 = "user-principal-2";
      
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      const positionResult = mockContract.openPosition(mockContract.GOLD, "long", 10, Date.now() + 86400000, user1);
      const positionId = positionResult.ok;
      
      expect(() => {
        mockContract.closePosition(positionId, user2); // Different user trying to close
      }).toThrow("ERR-UNAUTHORIZED");
    });

    it("should prevent closing already liquidated positions", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      const positionResult = mockContract.openPosition(mockContract.GOLD, "long", 10, Date.now() + 86400000, user);
      const positionId = positionResult.ok;
      
      // Close position first time
      mockContract.closePosition(positionId, user);
      
      // Try to close again
      expect(() => {
        mockContract.closePosition(positionId, user);
      }).toThrow("ERR-LIQUIDATION-THRESHOLD");
    });
  });

  describe("Market Controls", () => {
    it("should prevent trading when market is closed", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      // Close market
      mockContract.state.marketOpen = false;
      
      expect(() => {
        mockContract.openPosition(mockContract.GOLD, "long", 10, Date.now() + 86400000, user);
      }).toThrow("ERR-MARKET-CLOSED");
      
      expect(() => {
        mockContract.buyCommodityTokens(mockContract.GOLD, 1000000000, user);
      }).toThrow("ERR-MARKET-CLOSED");
    });
  });

  describe("Error Handling", () => {
    it("should handle non-existent commodity operations", () => {
      const user = "user-principal-1";
      const nonExistentCommodityId = 999;
      
      expect(() => {
        mockContract.buyCommodityTokens(nonExistentCommodityId, 1000000000, user);
      }).toThrow("ERR-INVALID-COMMODITY");
      
      expect(() => {
        mockContract.openPosition(nonExistentCommodityId, "long", 10, Date.now() + 86400000, user);
      }).toThrow("ERR-INVALID-COMMODITY");
    });

    it("should handle invalid amounts", () => {
      const user = "user-principal-1";
      mockContract.initializeCommodity(mockContract.GOLD, "Gold", "GOLD", "oz", 2000000000, 2000, 100);
      
      expect(() => {
        mockContract.buyCommodityTokens(mockContract.GOLD, 0, user);
      }).toThrow("ERR-INVALID-AMOUNT");
      
      expect(() => {
        mockContract.openPosition(mockContract.GOLD, "long", 0, Date.now() + 86400000, user);
      }).toThrow("ERR-INVALID-AMOUNT");
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete trading workflow", () => {
      const user = "trader-1";
      const oracleAddress = "oracle-1";
      
      // Initialize system
      mockContract.initializeCommodity(mockContract.GOLD, "Gold Futures", "GOLD", "oz", 2000000000, 2000, 100);
      mockContract.registerOracle(mockContract.GOLD, oracleAddress);
      
      // Buy tokens
      const tokenResult = mockContract.buyCommodityTokens(mockContract.GOLD, 5000000000, user);
      expect(tokenResult.ok).toBeGreaterThan(0);
      
      // Open position
      const positionResult = mockContract.openPosition(mockContract.GOLD, "long", 5, Date.now() + 86400000, user);
      expect(positionResult.ok).toBeGreaterThan(0);
      
      // Update price
      mockContract.updatePrice(mockContract.GOLD, 2200000000, 9500, oracleAddress);
      
      // Close position
    
   })
 })
})