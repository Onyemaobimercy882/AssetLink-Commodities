;; Commodity Futures Tokenization Protocol
;; Tokenized exposure to commodities: gold, oil, agricultural products

;; Constants
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-OWNER-ONLY (err u100))
(define-constant ERR-NOT-FOUND (err u101))
(define-constant ERR-INVALID-AMOUNT (err u102))
(define-constant ERR-INSUFFICIENT-BALANCE (err u103))
(define-constant ERR-INVALID-COMMODITY (err u104))
(define-constant ERR-MARKET-CLOSED (err u105))
(define-constant ERR-POSITION-EXPIRED (err u106))
(define-constant ERR-UNAUTHORIZED (err u107))
(define-constant ERR-ORACLE-STALE (err u108))
(define-constant ERR-MARGIN-INSUFFICIENT (err u109))
(define-constant ERR-LIQUIDATION-THRESHOLD (err u110))

;; Commodity Types
(define-constant GOLD u1)
(define-constant OIL u2)
(define-constant WHEAT u3)
(define-constant CORN u4)
(define-constant SOYBEANS u5)
(define-constant SILVER u6)
(define-constant COPPER u7)
(define-constant NATURAL-GAS u8)

;; Data Variables
(define-data-var next-position-id uint u1)
(define-data-var protocol-fee-rate uint u50) ;; 0.5% = 50 basis points
(define-data-var liquidation-threshold uint u8000) ;; 80% = 8000 basis points
(define-data-var oracle-validity-period uint u144) ;; ~24 hours in blocks
(define-data-var market-open bool true)

;; Token Supply Tracking
(define-fungible-token commodity-gold)
(define-fungible-token commodity-oil)
(define-fungible-token commodity-wheat)
(define-fungible-token commodity-corn)
(define-fungible-token commodity-soybeans)
(define-fungible-token commodity-silver)
(define-fungible-token commodity-copper)
(define-fungible-token commodity-natural-gas)

;; Data Maps
(define-map commodities
  uint
  {
    name: (string-ascii 32),
    symbol: (string-ascii 8),
    unit: (string-ascii 16),
    price: uint, ;; price in micro-units (e.g., $1.50 = 1500000)
    last-updated: uint,
    daily-change: int,
    volatility: uint, ;; basis points
    margin-requirement: uint, ;; basis points (e.g., 20% = 2000)
    contract-size: uint, ;; standard contract size
    active: bool
  }
)

(define-map futures-positions
  uint
  {
    user: principal,
    commodity-id: uint,
    position-type: (string-ascii 8), ;; "long" or "short"
    quantity: uint,
    entry-price: uint,
    current-price: uint,
    margin-deposited: uint,
    unrealized-pnl: int,
    created-at: uint,
    expiry: uint,
    liquidated: bool
  }
)

(define-map user-balances
  { user: principal, commodity-id: uint }
  {
    token-balance: uint,
    total-positions: uint,
    realized-pnl: int,
    margin-locked: uint
  }
)

(define-map commodity-stats
  uint
  {
    total-long-positions: uint,
    total-short-positions: uint,
    total-volume-24h: uint,
    open-interest: uint,
    funding-rate: int ;; basis points, can be negative
  }
)

(define-map oracle-feeds
  uint
  {
    oracle-address: principal,
    last-price: uint,
    last-update: uint,
    price-confidence: uint, ;; basis points
    active: bool
  }
)

;; Read-only functions
(define-read-only (get-commodity (commodity-id uint))
  (map-get? commodities commodity-id)
)

(define-read-only (get-position (position-id uint))
  (map-get? futures-positions position-id)
)

(define-read-only (get-user-balance (user principal) (commodity-id uint))
  (map-get? user-balances { user: user, commodity-id: commodity-id })
)

(define-read-only (get-commodity-stats (commodity-id uint))
  (map-get? commodity-stats commodity-id)
)

(define-read-only (get-oracle-feed (commodity-id uint))
  (map-get? oracle-feeds commodity-id)
)

(define-read-only (calculate-margin-requirement (commodity-id uint) (quantity uint))
  (let (
    (commodity-info (unwrap! (get-commodity commodity-id) (err u0)))
    (price (get price commodity-info))
    (margin-rate (get margin-requirement commodity-info))
  )
    (ok (/ (* quantity price margin-rate) u10000))
  )
)

(define-read-only (calculate-position-value (position-id uint))
  (let (
    (position (unwrap! (get-position position-id) (err u0)))
    (commodity-info (unwrap! (get-commodity (get commodity-id position)) (err u0)))
    (current-price (get price commodity-info))
    (entry-price (get entry-price position))
    (quantity (get quantity position))
  )
    (if (is-eq (get position-type position) "long")
      (ok (to-int (* quantity (- current-price entry-price))))
      (ok (to-int (* quantity (- entry-price current-price))))
    )
  )
)

(define-read-only (check-liquidation-risk (position-id uint))
  (let (
    (position (unwrap! (get-position position-id) (err u0)))
    (pnl (unwrap! (calculate-position-value position-id) (err u0)))
    (margin (to-int (get margin-deposited position)))
    (threshold (var-get liquidation-threshold))
  )
    (if (< pnl 0)
      (let ((loss (- 0 pnl)))
        (ok (>= (/ (* (to-uint loss) u10000) (get margin-deposited position)) threshold))
      )
      (ok false)
    )
  )
)

(define-read-only (get-commodity-token-balance (user principal) (commodity-id uint))
  (if (is-eq commodity-id GOLD) 
    (ft-get-balance commodity-gold user)
    (if (is-eq commodity-id OIL)
      (ft-get-balance commodity-oil user)
      (if (is-eq commodity-id WHEAT)
        (ft-get-balance commodity-wheat user)
        (if (is-eq commodity-id CORN)
          (ft-get-balance commodity-corn user)
          (if (is-eq commodity-id SOYBEANS)
            (ft-get-balance commodity-soybeans user)
            (if (is-eq commodity-id SILVER)
              (ft-get-balance commodity-silver user)
              (if (is-eq commodity-id COPPER)
                (ft-get-balance commodity-copper user)
                (if (is-eq commodity-id NATURAL-GAS)
                  (ft-get-balance commodity-natural-gas user)
                  u0
                )
              )
            )
          )
        )
      )
    )
  )
)

;; Private functions
(define-private (is-oracle-data-fresh (commodity-id uint))
  (let (
    (oracle-feed (unwrap! (get-oracle-feed commodity-id) false))
    (validity-period (var-get oracle-validity-period))
  )
    (and 
      (get active oracle-feed)
      (<= (- stacks-block-height (get last-update oracle-feed)) validity-period)
    )
  )
)

(define-private (mint-commodity-token (user principal) (commodity-id uint) (amount uint))
  (if (is-eq commodity-id GOLD) 
    (ft-mint? commodity-gold amount user)
    (if (is-eq commodity-id OIL)
      (ft-mint? commodity-oil amount user)
      (if (is-eq commodity-id WHEAT)
        (ft-mint? commodity-wheat amount user)
        (if (is-eq commodity-id CORN)
          (ft-mint? commodity-corn amount user)
          (if (is-eq commodity-id SOYBEANS)
            (ft-mint? commodity-soybeans amount user)
            (if (is-eq commodity-id SILVER)
              (ft-mint? commodity-silver amount user)
              (if (is-eq commodity-id COPPER)
                (ft-mint? commodity-copper amount user)
                (if (is-eq commodity-id NATURAL-GAS)
                  (ft-mint? commodity-natural-gas amount user)
                  (err u1)
                )
              )
            )
          )
        )
      )
    )
  )
)

(define-private (burn-commodity-token (user principal) (commodity-id uint) (amount uint))
  (if (is-eq commodity-id GOLD) 
    (ft-burn? commodity-gold amount user)
    (if (is-eq commodity-id OIL)
      (ft-burn? commodity-oil amount user)
      (if (is-eq commodity-id WHEAT)
        (ft-burn? commodity-wheat amount user)
        (if (is-eq commodity-id CORN)
          (ft-burn? commodity-corn amount user)
          (if (is-eq commodity-id SOYBEANS)
            (ft-burn? commodity-soybeans amount user)
            (if (is-eq commodity-id SILVER)
              (ft-burn? commodity-silver amount user)
              (if (is-eq commodity-id COPPER)
                (ft-burn? commodity-copper amount user)
                (if (is-eq commodity-id NATURAL-GAS)
                  (ft-burn? commodity-natural-gas amount user)
                  (err u1)
                )
              )
            )
          )
        )
      )
    )
  )
)

(define-private (update-commodity-stats (commodity-id uint) (position-type (string-ascii 8)) (quantity uint) (is-opening bool))
  (let (
    (current-stats (default-to
      { total-long-positions: u0, total-short-positions: u0, total-volume-24h: u0, open-interest: u0, funding-rate: 0 }
      (get-commodity-stats commodity-id)
    ))
  )
    (map-set commodity-stats commodity-id
      (if is-opening
        (if (is-eq position-type "long")
          (merge current-stats {
            total-long-positions: (+ (get total-long-positions current-stats) quantity),
            total-volume-24h: (+ (get total-volume-24h current-stats) quantity),
            open-interest: (+ (get open-interest current-stats) quantity)
          })
          (merge current-stats {
            total-short-positions: (+ (get total-short-positions current-stats) quantity),
            total-volume-24h: (+ (get total-volume-24h current-stats) quantity),
            open-interest: (+ (get open-interest current-stats) quantity)
          })
        )
        (if (is-eq position-type "long")
          (merge current-stats {
            total-long-positions: (- (get total-long-positions current-stats) quantity),
            open-interest: (- (get open-interest current-stats) quantity)
          })
          (merge current-stats {
            total-short-positions: (- (get total-short-positions current-stats) quantity),
            open-interest: (- (get open-interest current-stats) quantity)
          })
        )
      )
    )
  )
)

;; Public functions

;; Initialize commodity data
(define-public (initialize-commodity
  (commodity-id uint)
  (name (string-ascii 32))
  (symbol (string-ascii 8))
  (unit (string-ascii 16))
  (initial-price uint)
  (margin-requirement uint)
  (contract-size uint)
)
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (asserts! (<= margin-requirement u5000) ERR-INVALID-AMOUNT) ;; Max 50% margin
    
    (map-set commodities commodity-id {
      name: name,
      symbol: symbol,
      unit: unit,
      price: initial-price,
      last-updated: stacks-block-height,
      daily-change: 0,
      volatility: u1000, ;; Default 10%
      margin-requirement: margin-requirement,
      contract-size: contract-size,
      active: true
    })
    
    (map-set commodity-stats commodity-id {
      total-long-positions: u0,
      total-short-positions: u0,
      total-volume-24h: u0,
      open-interest: u0,
      funding-rate: 0
    })
    
    (ok true)
  )
)

;; Register oracle for price feeds
(define-public (register-oracle (commodity-id uint) (oracle-address principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    
    (map-set oracle-feeds commodity-id {
      oracle-address: oracle-address,
      last-price: u0,
      last-update: u0,
      price-confidence: u9500, ;; 95% confidence
      active: true
    })
    
    (ok true)
  )
)

;; Update commodity price (called by oracle)
(define-public (update-price (commodity-id uint) (new-price uint) (confidence uint))
  (let (
    (commodity-info (unwrap! (get-commodity commodity-id) ERR-NOT-FOUND))
    (oracle-feed (unwrap! (get-oracle-feed commodity-id) ERR-NOT-FOUND))
    (old-price (get price commodity-info))
    (price-change (if (>= new-price old-price) 
                    (- new-price old-price) 
                    (- old-price new-price)))
    (daily-change-pct (if (> old-price u0)
                       (/ (* price-change u10000) old-price)
                       u0))
  )
    (asserts! (is-eq tx-sender (get oracle-address oracle-feed)) ERR-UNAUTHORIZED)
    (asserts! (>= confidence u8000) ERR-ORACLE-STALE) ;; Min 80% confidence
    
    ;; Update commodity price
    (map-set commodities commodity-id
      (merge commodity-info {
        price: new-price,
        last-updated: stacks-block-height,
        daily-change: (if (>= new-price old-price) 
                       (to-int daily-change-pct)
                       (- 0 (to-int daily-change-pct)))
      })
    )
    
    ;; Update oracle feed
    (map-set oracle-feeds commodity-id
      (merge oracle-feed {
        last-price: new-price,
        last-update: stacks-block-height,
        price-confidence: confidence
      })
    )
    
    (ok true)
  )
)

;; Purchase commodity tokens (synthetic exposure)
(define-public (buy-commodity-tokens (commodity-id uint) (stx-amount uint))
  (let (
    (commodity-info (unwrap! (get-commodity commodity-id) ERR-NOT-FOUND))
    (price (get price commodity-info))
    (fee-amount (/ (* stx-amount (var-get protocol-fee-rate)) u10000))
    (net-amount (- stx-amount fee-amount))
    (token-amount (/ net-amount price))
    (current-balance (default-to
      { token-balance: u0, total-positions: u0, realized-pnl: 0, margin-locked: u0 }
      (get-user-balance tx-sender commodity-id)
    ))
  )
    (asserts! (var-get market-open) ERR-MARKET-CLOSED)
    (asserts! (get active commodity-info) ERR-INVALID-COMMODITY)
    (asserts! (> stx-amount u0) ERR-INVALID-AMOUNT)
    (asserts! (is-oracle-data-fresh commodity-id) ERR-ORACLE-STALE)
    
    ;; Transfer STX from user
    (try! (stx-transfer? stx-amount tx-sender (as-contract tx-sender)))
    
    ;; Mint commodity tokens to user
    (try! (mint-commodity-token tx-sender commodity-id token-amount))
    
    ;; Update user balance
    (map-set user-balances { user: tx-sender, commodity-id: commodity-id }
      (merge current-balance {
        token-balance: (+ (get token-balance current-balance) token-amount)
      })
    )
    
    (ok token-amount)
  )
)

;; Sell commodity tokens
(define-public (sell-commodity-tokens (commodity-id uint) (token-amount uint))
  (let (
    (commodity-info (unwrap! (get-commodity commodity-id) ERR-NOT-FOUND))
    (price (get price commodity-info))
    (stx-value (* token-amount price))
    (fee-amount (/ (* stx-value (var-get protocol-fee-rate)) u10000))
    (net-proceeds (- stx-value fee-amount))
    (current-balance (unwrap! (get-user-balance tx-sender commodity-id) ERR-NOT-FOUND))
  )
    (asserts! (var-get market-open) ERR-MARKET-CLOSED)
    (asserts! (get active commodity-info) ERR-INVALID-COMMODITY)
    (asserts! (>= (get token-balance current-balance) token-amount) ERR-INSUFFICIENT-BALANCE)
    (asserts! (is-oracle-data-fresh commodity-id) ERR-ORACLE-STALE)
    
    ;; Burn commodity tokens
    (try! (burn-commodity-token tx-sender commodity-id token-amount))
    
    ;; Transfer STX to user
    (try! (as-contract (stx-transfer? net-proceeds tx-sender tx-sender)))
    
    ;; Update user balance
    (map-set user-balances { user: tx-sender, commodity-id: commodity-id }
      (merge current-balance {
        token-balance: (- (get token-balance current-balance) token-amount)
      })
    )
    
    (ok net-proceeds)
  )
)

;; Open futures position
(define-public (open-position
  (commodity-id uint)
  (position-type (string-ascii 8))
  (quantity uint)
  (expiry-blocks uint)
)
  (let (
    (position-id (var-get next-position-id))
    (commodity-info (unwrap! (get-commodity commodity-id) ERR-NOT-FOUND))
    (current-price (get price commodity-info))
    (margin-required (unwrap! (calculate-margin-requirement commodity-id quantity) ERR-MARGIN-INSUFFICIENT))
    (current-balance (default-to
      { token-balance: u0, total-positions: u0, realized-pnl: 0, margin-locked: u0 }
      (get-user-balance tx-sender commodity-id)
    ))
  )
    (asserts! (var-get market-open) ERR-MARKET-CLOSED)
    (asserts! (get active commodity-info) ERR-INVALID-COMMODITY)
    (asserts! (or (is-eq position-type "long") (is-eq position-type "short")) ERR-INVALID-AMOUNT)
    (asserts! (> quantity u0) ERR-INVALID-AMOUNT)
    (asserts! (> expiry-blocks stacks-block-height) ERR-INVALID-AMOUNT)
    (asserts! (is-oracle-data-fresh commodity-id) ERR-ORACLE-STALE)
    
    ;; Transfer margin requirement
    (try! (stx-transfer? margin-required tx-sender (as-contract tx-sender)))
    
    ;; Create position
    (map-set futures-positions position-id {
      user: tx-sender,
      commodity-id: commodity-id,
      position-type: position-type,
      quantity: quantity,
      entry-price: current-price,
      current-price: current-price,
      margin-deposited: margin-required,
      unrealized-pnl: 0,
      created-at: stacks-block-height,
      expiry: expiry-blocks,
      liquidated: false
    })
    
    ;; Update user balance
    (map-set user-balances { user: tx-sender, commodity-id: commodity-id }
      (merge current-balance {
        total-positions: (+ (get total-positions current-balance) u1),
        margin-locked: (+ (get margin-locked current-balance) margin-required)
      })
    )
    
    ;; Update commodity stats
    (update-commodity-stats commodity-id position-type quantity true)
    
    (var-set next-position-id (+ position-id u1))
    (ok position-id)
  )
)

;; Close futures position
(define-public (close-position (position-id uint))
  (let (
    (position (unwrap! (get-position position-id) ERR-NOT-FOUND))
    (commodity-info (unwrap! (get-commodity (get commodity-id position)) ERR-NOT-FOUND))
    (current-price (get price commodity-info))
    (pnl (unwrap! (calculate-position-value position-id) ERR-INVALID-AMOUNT))
    (margin-refund (get margin-deposited position))
    (settlement-amount (if (>= pnl 0)
                        (+ margin-refund (to-uint pnl))
                        (if (>= margin-refund (to-uint (- 0 pnl)))
                          (- margin-refund (to-uint (- 0 pnl)))
                          u0)))
    (current-balance (unwrap! (get-user-balance tx-sender (get commodity-id position)) ERR-NOT-FOUND))
  )
    (asserts! (is-eq tx-sender (get user position)) ERR-UNAUTHORIZED)
    (asserts! (not (get liquidated position)) ERR-LIQUIDATION-THRESHOLD)
    (asserts! (var-get market-open) ERR-MARKET-CLOSED)
    (asserts! (is-oracle-data-fresh (get commodity-id position)) ERR-ORACLE-STALE)
    
    ;; Transfer settlement to user if there are proceeds
    (if (> settlement-amount u0)
      (try! (as-contract (stx-transfer? settlement-amount tx-sender tx-sender)))
      (ok true)
    )
    
    ;; Update position as closed
    (map-set futures-positions position-id
      (merge position {
        current-price: current-price,
        unrealized-pnl: pnl,
        liquidated: true
      })
    )
    
    ;; Update user balance
    (map-set user-balances { user: tx-sender, commodity-id: (get commodity-id position) }
      (merge current-balance {
        total-positions: (- (get total-positions current-balance) u1),
        realized-pnl: (+ (get realized-pnl current-balance) pnl),
        margin-locked: (- (get margin-locked current-balance) margin-refund)
      })
    )
    
    ;; Update commodity stats
    (update-commodity-stats (get commodity-id position) (get position-type position) (get quantity position) false)
    
    (ok settlement-amount)
  )
)

;; Liquidate position (can be called by anyone if position is underwater)
(define-public (liquidate-position (position-id uint))
  (let (
    (position (unwrap! (get-position position-id) ERR-NOT-FOUND))
    (should-liquidate (unwrap! (check-liquidation-risk position-id) ERR-INVALID-AMOUNT))
    (pnl (unwrap! (calculate-position-value position-id) ERR-INVALID-AMOUNT))
    (current-balance (unwrap! (get-user-balance (get user position) (get commodity-id position)) ERR-NOT-FOUND))
  )
    (asserts! should-liquidate ERR-LIQUIDATION-THRESHOLD)
    (asserts! (not (get liquidated position)) ERR-LIQUIDATION-THRESHOLD)
    
    ;; Mark position as liquidated
    (map-set futures-positions position-id
      (merge position {
        liquidated: true,
        unrealized-pnl: pnl
      })
    )
    
    ;; Update user balance
    (map-set user-balances { user: (get user position), commodity-id: (get commodity-id position) }
      (merge current-balance {
        total-positions: (- (get total-positions current-balance) u1),
        realized-pnl: (+ (get realized-pnl current-balance) pnl),
        margin-locked: (- (get margin-locked current-balance) (get margin-deposited position))
      })
    )
    
    ;; Update commodity stats
    (update-commodity-stats (get commodity-id position) (get position-type position) (get quantity position) false)
    
    (ok true)
  )
)

;; Emergency market controls
(define-public (toggle-market)
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (var-set market-open (not (var-get market-open)))
    (ok (var-get market-open))
  )
)

;; Update protocol parameters
(define-public (update-protocol-fee (new-fee uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (asserts! (<= new-fee u500) ERR-INVALID-AMOUNT) ;; Max 5%
    (var-set protocol-fee-rate new-fee)
    (ok true)
  )
)

(define-public (update-liquidation-threshold (new-threshold uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (asserts! (and (>= new-threshold u5000) (<= new-threshold u9500)) ERR-INVALID-AMOUNT) ;; 50-95%
    (var-set liquidation-threshold new-threshold)
    (ok true)
  )
)