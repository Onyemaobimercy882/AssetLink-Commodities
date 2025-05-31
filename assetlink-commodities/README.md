# Commodity Futures Tokenization Protocol

A decentralized protocol built on Stacks blockchain that enables tokenized exposure to commodity futures including gold, oil, agricultural products, and other raw materials.

## Overview

This protocol allows users to:
- Purchase synthetic commodity tokens backed by real-time price feeds
- Open leveraged futures positions (long/short) on various commodities
- Trade tokenized exposure to commodities without physical delivery
- Participate in decentralized commodity markets with transparent pricing

## Supported Commodities

The protocol currently supports 8 major commodity categories:

| Commodity | ID | Token Symbol |
|-----------|----| -------------|
| Gold | 1 | commodity-gold |
| Oil | 2 | commodity-oil |
| Wheat | 3 | commodity-wheat |
| Corn | 4 | commodity-corn |
| Soybeans | 5 | commodity-soybeans |
| Silver | 6 | commodity-silver |
| Copper | 7 | commodity-copper |
| Natural Gas | 8 | commodity-natural-gas |

## Key Features

### Synthetic Token Trading
- Buy/sell commodity-backed tokens using STX
- 1:1 price exposure to underlying commodities
- Automatic token minting and burning
- Protocol fees of 0.5% (configurable)

### Futures Trading
- Open long/short positions with margin requirements
- Customizable position expiry times
- Automatic liquidation when positions become underwater
- Real-time P&L calculations

### Oracle Integration
- Decentralized price feeds with confidence ratings
- Stale data protection (24-hour validity window)
- Multiple oracle support per commodity

### Risk Management
- Configurable margin requirements (up to 50%)
- Liquidation threshold at 80% (configurable 50-95%)
- Market circuit breakers for emergency situations

## Smart Contract Architecture

### Core Data Structures

**Commodities Map**: Stores commodity metadata including prices, volatility, and margin requirements

**Futures Positions**: Tracks individual user positions with entry prices, quantities, and P&L

**User Balances**: Maintains token balances, position counts, and locked margins per user

**Oracle Feeds**: Manages price feed data with confidence intervals and freshness checks

### Key Functions

#### Trading Functions
- `buy-commodity-tokens`: Purchase synthetic commodity exposure
- `sell-commodity-tokens`: Redeem tokens for STX
- `open-position`: Create leveraged futures positions
- `close-position`: Settle and close existing positions

#### Oracle Functions
- `register-oracle`: Add authorized price feed providers
- `update-price`: Update commodity prices (oracle-only)

#### Admin Functions
- `initialize-commodity`: Set up new commodity markets
- `toggle-market`: Emergency market controls
- `update-protocol-fee`: Adjust trading fees
- `update-liquidation-threshold`: Modify risk parameters

## Getting Started

### Prerequisites
- Stacks wallet (Hiro Wallet, Xverse, etc.)
- STX tokens for trading and gas fees
- Access to Stacks blockchain (mainnet/testnet)

### Contract Deployment

1. Deploy the contract to Stacks blockchain
2. Initialize supported commodities with `initialize-commodity`
3. Register oracle providers using `register-oracle`
4. Begin trading once oracles start providing price feeds

### Usage Examples

#### Buy Gold Tokens
```clarity
(contract-call? .commodity-protocol buy-commodity-tokens u1 u1000000) ;; Buy $1000 worth of gold tokens
```

#### Open Long Oil Position
```clarity
(contract-call? .commodity-protocol open-position u2 "long" u100 u1000) ;; Long 100 units of oil, expires in 1000 blocks
```

#### Check Position Status
```clarity
(contract-call? .commodity-protocol get-position u1) ;; Get details for position ID 1
```

## Risk Considerations

⚠️ **Important Risk Warnings:**

1. **Price Volatility**: Commodity prices can be highly volatile
2. **Liquidation Risk**: Leveraged positions may be liquidated if they move against you
3. **Oracle Dependency**: Price accuracy depends on external oracle feeds
4. **Smart Contract Risk**: As with all DeFi protocols, smart contract bugs are possible
5. **Regulatory Risk**: Commodity trading regulations may apply in your jurisdiction

## Protocol Parameters

| Parameter | Default Value | Range | Description |
|-----------|---------------|-------|-------------|
| Protocol Fee | 0.5% (50 bp) | 0-5% | Trading fee on all transactions |
| Liquidation Threshold | 80% (8000 bp) | 50-95% | Position liquidation trigger |
| Oracle Validity | 144 blocks (~24h) | Configurable | Maximum age for price data |
| Max Margin Requirement | 50% | 0-50% | Maximum margin for new commodities |

## API Reference

### Read-Only Functions

```clarity
;; Get commodity information
(get-commodity (commodity-id uint))

;; Get user's token balance for specific commodity
(get-user-balance (user principal) (commodity-id uint))

;; Get position details
(get-position (position-id uint))

;; Calculate required margin
(calculate-margin-requirement (commodity-id uint) (quantity uint))

;; Check if position should be liquidated
(check-liquidation-risk (position-id uint))
```

### Public Functions

```clarity
;; Trading functions
(buy-commodity-tokens (commodity-id uint) (stx-amount uint))
(sell-commodity-tokens (commodity-id uint) (token-amount uint))
(open-position (commodity-id uint) (position-type string) (quantity uint) (expiry-blocks uint))
(close-position (position-id uint))
(liquidate-position (position-id uint))
```

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| 100 | ERR-OWNER-ONLY | Function restricted to contract owner |
| 101 | ERR-NOT-FOUND | Requested data not found |
| 102 | ERR-INVALID-AMOUNT | Invalid amount specified |
| 103 | ERR-INSUFFICIENT-BALANCE | Insufficient token balance |
| 104 | ERR-INVALID-COMMODITY | Commodity not supported/active |
| 105 | ERR-MARKET-CLOSED | Market is currently closed |
| 106 | ERR-POSITION-EXPIRED | Position has expired |
| 107 | ERR-UNAUTHORIZED | Caller not authorized |
| 108 | ERR-ORACLE-STALE | Price data is too old |
| 109 | ERR-MARGIN-INSUFFICIENT | Insufficient margin provided |
| 110 | ERR-LIQUIDATION-THRESHOLD | Position subject to liquidation |

## Contributing

This protocol is open for community contributions. Please:

1. Review the code thoroughly before suggesting changes
2. Test all modifications on testnet first
3. Follow Clarity best practices and security guidelines
4. Document any new features or parameter changes

## Security Considerations

- All price updates require oracle authorization
- Position liquidations can be triggered by any user when thresholds are met
- Emergency market shutdown capabilities exist for extreme scenarios
- Margin requirements and liquidation thresholds are configurable for risk management

## License

[Specify your license here - MIT, Apache 2.0, etc.]

## Disclaimer

This protocol is experimental software. Users trade at their own risk. The developers make no warranties about the accuracy of price feeds, the security of smart contracts, or the profitability of trading strategies. Always do your own research and never invest more than you can afford to lose.

---

*Built on Stacks blockchain for decentralized commodity trading*