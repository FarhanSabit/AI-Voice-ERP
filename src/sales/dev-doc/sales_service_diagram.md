# VoiceERP Sales & Returns Services Architectural Blueprint & ASCII Diagrams

This document contains full ASCII diagrams mapping the architecture, state lifecycles, transactional operations, and database integrations for both the `SalesService` and `SaleReturnsService` classes within VoiceERP.

---

## 1. System Architecture & Relational Topology

The diagram below represents how the `SalesService` interacts with NestJS controllers, external components, and the database schema. It shows the cascading effects of actions on various ledgers and transaction systems.

```text
               ┌────────────────────────────────────────────────────────┐
               │              HTTP Client / Voice Trigger               │
               └───────────────────────────┬────────────────────────────┘
                                           │ Request (DTO)
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │                    SalesController                     │
               └───────────────────────────┬────────────────────────────┘
                                           │ Internal Method Call
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                      SalesService                                      │
│                                                                                        │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌──────────────────────────┐  │
│  │     PrismaService      │  │       PinoLogger       │  │  generateInvoiceNo(tx)   │  │
│  │  (Database Connection) │  │   (Structured Logs)    │  │ (Sequenced Date-Prefix)  │  │
│  └───────────┬────────────┘  └───────────┬────────────┘  └────────────┬─────────────┘  │
│              │                           │                            │                │
│              └───────────────────────────┼────────────────────────────┘                │
│                                          ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                 Service API                                      │  │
│  ├──────────────────────────────────────────────────────────────────────────────────┤  │
│  │ • findAll()     • findOne()     • create()     • update()    • editSale()    ... │  │
│  └───────────────────────────────────────┬──────────────────────────────────────────┘  │
└──────────────────────────────────────────┼─────────────────────────────────────────────┘
                                           │ Prisma Transaction Client (tx)
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                Database Layer (Prisma)                                 │
│                                                                                        │
│                     ┌─────────────────┐       ┌─────────────────┐                      │
│                     │      Sale       │──────▶│    SaleItem     │                      │
│                     └────────┬────────┘       └────────┬────────┘                      │
│                              │                         │                               │
│        ┌─────────────────────┼───────────┬─────────────┼───────────┐                   │
│        ▼                     ▼           ▼             ▼           ▼                   │
│  ┌───────────┐         ┌───────────┐┌───────────┐┌───────────┐┌───────────┐            │
│  │   Party   │         │  Account  ││  Payment  ││   Item    ││   Batch   │            │
│  └─────┬─────┘         └─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘            │
│        │                     │            │            │            │                  │
│        ▼                     ▼            ▼            ▼            ▼                  │
│  ┌───────────┐         ┌───────────┐┌───────────┐┌───────────┐┌───────────┐            │
│  │PartyLedger│         │ Ledger/Bal││Pay. Record││ StockLedg ││ BatchQty  │            │
│  │ (Credit)  │         │ (Liquid)  ││ (Auditing)││  (Audit)  ││ (FEFO/FIF)│            │
│  └───────────┘         └───────────┘└───────────┘└───────────┘└───────────┘            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Sale Status State Transitions

The database status of a Sale progresses through the following state machine. Operations like status updates (`update`), soft deletion (`remove`), and sales editing (`editSale`) validate transitions and perform inventory/ledger adjustments accordingly.

```text
               ┌───────────────────────┐
               │    Draft / Created    │
               └───────────┬───────────┘
                           │
                           ▼
                  [Paid Amount check]
                 /                   \
        (Full Payment)           (Partial/No Payment)
               /                       \
              ▼                         ▼
   ┌────────────────────┐     ┌────────────────────┐
   │     Completed      │     │      Pending       │
   └──────────┬─────────┘     └─────────┬──────────┘
              │                         │
              ├─────────────────────────┴───────────────┐
              │                                         │
              ▼ [Status Change / Cancel / Soft Delete]  ▼ [Returns Issued]
   ┌────────────────────┐                    ┌────────────────────┐
   │     Cancelled      │                    │      Returned      │
   └────────────────────┘                    └────────────────────┘
     * Restores stock                          * Restores stock
     * Reverses credit dues                    * Reverses credit dues
     * StockLedger (adj.)                      * StockLedger (return)
     * TERMINAL STATE                          * TERMINAL STATE
```

---

## 3. Transactional Execution Flows

### A. Creating a Sale (`create()`)
This process runs completely inside a single isolation transaction. It verifies stock, resolves batches using First-Expiry-First-Out (FEFO) order, creates relevant ledger audits, updates cash/bank account balances, and issues standard payment receipts.

```text
                        START SalesService.create(dto)
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │ Begin Prisma Transaction  │
                        └─────────────┬─────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   Generate Invoice No.    │
                        │ INV-YYYYMMDD-[Seq Number] │
                        └─────────────┬─────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │ Initialize item data arrays │
                        │  subtotal=0, totalProfit=0│
                        └─────────────┬─────────────┘
                                      │
                                      ▼
                       ┌─────────────────────────────┐
             ◄─────────┤ Loop through each dto.item  │◀────────┐
             │         └──────────────┬──────────────┘         │
             │                        │                        │
             │                        ▼                        │
             │          ┌───────────────────────────┐          │
             │          │   Check Item existence    │          │
             │          │    and total Stock Qty    │          │
             │          └─────────────┬─────────────┘          │
             │                        │                        │
             │                 [Stock Available?]              │
             │                 /              \                │
             │             (No)                (Yes)           │
             │             /                      \            │
             │            ▼                        ▼           │
             │    ┌──────────────┐         ┌────────────────┐  │
             │    │ Throw 400    │         │  trackBatch?   │  │
             │    │ Bad Request  │         └───────┬────────┘  │
             │    └──────────────┘                 │           │
             │                       ┌─────────────┴───────┐   │
             │                  (No) │                     │(Yes)
             │                       ▼                     ▼   │
             │               ┌──────────────┐      ┌──────────────┐    │
             │               │Compute item  │      │Query active  │    │
             │               │total & profit│      │batches (FEFO)│    │
             │               │using Item    │      │for Item      │    │
             │               │default cost  │      └──────┬───────┘    │
             │               └──────┬───────┘             │            │
             │                      │                     ▼            │
             │                      │              ┌──────────────┐    │
             │                      │              │Loop & deduct │    │
             │                      │              │qty from batch│    │
             │                      │              │decrementing  │    │
             │                      │              │remainingQty  │    │
             │                      │              └──────┬───────┘    │
             │                      │                     │            │
             │                      │                     ▼            │
             │                      │              [Fully met?]        │
             │                      │              /          \        │
             │                      │          (No)           (Yes)    │
             │                      │          /                  \    │
             │                      │         ▼                    ▼   │
             │                      │  ┌────────────┐       ┌────────┐ │
             │                      │  │ Throw 400  │       │Add batch││
             │                      │  │ Bad Request│       │to list ││
             │                      │  └────────────┘       └────┬───┘ │
             │                      │                            │     │
             │                      └──────────────┬─────────────┘     │
             │                                     ▼                   │
             │                               ┌───────────┐             │
             │                               │Push to list│             │
             │                               │saleItems   │             │
             │                               └─────┬─────┘             │
             │                                     │                   │
             └─────────────────────────────────────┼───────────────────┘
                                                   └───────────────────(Process Next Item)

                                      ┌────────────┐
                                      │Loop End    │
                                      └─────┬──────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │  Calculate Grand Totals:  │
                              │  total = sub - disc + tax │
                              │  dueAmount = total - paid │
                              │  status = due > 0 ?       │
                              │    'pending' : 'completed'│
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │    Create Sale & Items    │
                              │        records DB         │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │   Loop items in Sale:     │
                              │  • Decrement item stock   │
                              │  • Set item lastSaleDate  │
                              │  • Create StockLedger (-Q)│
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                                   [partyId & due > 0?]
                                   /                  \
                               (Yes)                   (No)
                               /                          \
                              ▼                            ▼
                 ┌───────────────────────┐             [paidAmount > 0?]
                 │ Increment Party       │             /               \
                 │ currentBalance by due │          (Yes)             (No)
                 │ Create PartyLedger    │           /                   \
                 │ entry                 │          ▼                     ▼
                 └──────────┬────────────┘     ┌───────────┐        ┌───────────┐
                            │                  │Find/Create│        │  Commit   │
                            │                  │Account by │        │Transaction│
                            │                  │paymentMode│        └─────┬─────┘
                            │                  └─────┬─────┘              │
                            │                        │                    │
                            │                        ▼                    │
                            │                  ┌───────────┐              │
                            │                  │Increment  │              │
                            │                  │Account bal│              │
                            │                  │& Create   │              │
                            │                  │Payment rec│              │
                            │                  └─────┬─────┘              │
                            └────────────────────────┼────────────────────┘
                                                     ▼
                                               ┌───────────┐
                                               │  Commit   │
                                               │Transaction│
                                               └─────┬─────┘
                                                     │
                                                     ▼
                                               Log Info & Ret
                                              Transformed Sale
```

---

### B. Editing a Sale (`editSale()`)
Replaces the items of a sale completely and reconciles the resulting stock and party ledger balance differences.

```text
                      START SalesService.editSale(dto)
                                     │
                                     ▼
                       ┌───────────────────────────┐
                       │   Fetch Sale with Items   │
                       └─────────────┬─────────────┘
                                     │
                        [Exists & Status valid?]
                        /                      \
                     (No)                      (Yes)
                     /                            \
                    ▼                              ▼
            ┌──────────────┐             ┌───────────────────┐
            │ Throw 404/403│             │ Begin Transaction │
            └──────────────┘             └─────────┬─────────┘
                                                   │
                                                   ▼
                                         ┌───────────────────┐
                                         │ Loop through old  │
                                         │ SaleItem entries: │
                                         │ • Revert Item Qty │
                                         │ • Revert Batch Qty│
                                         │ • StockLedger adj.│
                                         └─────────┬─────────┘
                                                   │
                                                   ▼
                                         ┌───────────────────┐
                                         │ Delete old        │
                                         │ SaleItem records  │
                                         └─────────┬─────────┘
                                                   │
                                                   ▼
                                         ┌───────────────────┐
                                         │ Loop & Validate   │
                                         │ new items, deduct │
                                         │ stock (FEFO/Reg), │
                                         │ Create SaleItems, │
                                         │ Log StockLedger   │
                                         └─────────┬─────────┘
                                                   │
                                                   ▼
                                         ┌───────────────────┐
                                         │ Recalculate totals│
                                         │ newDueAmount =    │
                                         │ newTotal - paid   │
                                         └─────────┬─────────┘
                                                   │
                                                   ▼
                                        [partyId specified?]
                                        /                  \
                                     (Yes)                 (No)
                                     /                        \
                                    ▼                          ▼
                          ┌───────────────────┐        ┌───────────────┐
                          │ Calculate diff:   │        │ Update Sale   │
                          │ dueDiff =         │        │ header fields │
                          │  newDue - oldDue  │        │ in database   │
                          │ Update Party Bal  │        └───────┬───────┘
                          │ Create PartyLedger│                │
                          └─────────┬─────────┘                │
                                    │                          │
                                    └──────────────────────────┤
                                                               │
                                                               ▼
                                                       ┌───────────────┐
                                                       │    Commit     │
                                                       │  Transaction  │
                                                       └───────┬───────┘
                                                               │
                                                               ▼
                                                         Log Info & Ret
                                                        Transformed Sale
```

---

### C. Status Updates & Deletions (`update()` / `remove()`)
These functions update a sale's status (transitions like cancelling or returning) or soft-delete it by marking it cancelled. They ensure inventory is restocked and credits are reversed.

```text
             ┌───────────────────────────────────────────────────────┐
             │           SalesService.update() / remove()            │
             └──────────────────────────┬────────────────────────────┘
                                        │
                                        ▼
                         ┌─────────────────────────────┐
                         │    Fetch existing sale &    │
                         │      associated items       │
                         └──────────────┬──────────────┘
                                        │
                           [Is Status transition ok?]
                           /                        \
                        (No)                        (Yes)
                        /                              \
                       ▼                                ▼
               ┌───────────────┐              ┌───────────────────┐
               │  Throw 403    │              │ Begin Transaction │
               │  Forbidden    │              └─────────┬─────────┘
               └───────────────┘                        │
                                                        ▼
                                           ┌─────────────────────────────┐
                                           │  Are we cancelling/returning│
                                           │   the sale (Status update/  │
                                           │       soft deletion)?       │
                                           └────────────┬────────────────┘
                                                        │
                                              ┌─────────┴─────────┐
                                         (Yes)│                   │(No)
                                              ▼                   ▼
                                    ┌───────────────────┐   ┌────────────┐
                                    │For each SaleItem: │   │Update Sale │
                                    │• Add Qty back to  │   │notes or    │
                                    │  Item stock       │   │non-reversal│
                                    │• Increment Batch  │   │status directly
                                    │  remainingQty     │   └─────┬──────┘
                                    │• StockLedger (+Q) │         │
                                    └─────────┬─────────┘         │
                                              │                   │
                                              ▼                   │
                                    [partyId & due > 0?]          │
                                    /                  \          │
                                 (Yes)                 (No)       │
                                 /                        \       │
                                ▼                          ▼      │
                      ┌───────────────────┐         ┌───────────┐ │
                      │Party Bal -= due   │         │Update Sale│ │
                      │Create PartyLedger │         │status to  │ │
                      │adjustment         │         │target     │ │
                      └─────────┬─────────┘         └─────┬─────┘ │
                                │                         │       │
                                └─────────────────────────┼───────┘
                                                          │
                                                          ▼
                                                    ┌───────────┐
                                                    │  Commit   │
                                                    │Transaction│
                                                    └─────┬─────┘
                                                          │
                                                          ▼
                                                    Log Info & Ret
                                                   Transformed Sale
```

---

## 4. Query Boundaries & Dashboard Aggregations (`getSummary()`)

The dashboard stats query aggregates revenue, profit, sale counts, and averages across multiple sliding time windows relative to `now = current timestamp`:

```text
Timeline & Range Boundaries:
┌─────────────────────────┬─────────────────────────┬─────────────────────────┐
│     Yesterday Range     │       Today Range       │   All-Time (No Limit)   │
│ [yesterdayStart]        │ [todayStart]            │                         │
│   (todayStart - 24h)    │   (00:00:00 Local)      │                         │
│           │             │           │             │                         │
│           ▼             │           ▼             │                         │
│     yesterdayEnd        │        todayEnd         │                         │
│   (equal to todayStart) │   (todayStart + 24h)    │                         │
└─────────────────────────┴─────────────────────────┴─────────────────────────┘
┌───────────────────────────────────────────────────┬─────────────────────────┐
│                 Last Month Range                  │    This Month Range     │
│ [lastMonthStart]                                  │ [monthStart]            │
│   (1st of last month)                             │   (1st of this month)   │
│           │                                       │           │             │
│           ▼                                       │           ▼             │
│     lastMonthEnd                                  │       monthEnd          │
│   (equal to monthStart)                           │   (1st of next month)   │
└───────────────────────────────────────────────────┴─────────────────────────┘

Aggregations Run in Parallel:
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Today Agg   │ │Yesterday Agg │ │  Month Agg   │ │LastMonth Agg │ │ All-Time Agg │
│  - Sum(total)│ │  - Sum(total)│ │  - Sum(total)│ │  - Sum(total)│ │  - Sum(total)│
│  - Avg(total)│ │  - Avg(total)│ │  - Avg(total)│ │  - Avg(total)│ │  - Sum(prof) │
│  - Count(*)  │ │  - Count(*)  │ │  - Count(*)  │ │  - Count(*)  │ │  - Avg(total)│
│              │ │              │ │              │ │              │ │  - Count(*)  │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │                │                │
       └────────────────┼────────────────┼────────────────┼────────────────┘
                        ▼                ▼                ▼
                 [ pctChange() ]  [ pctChange() ]  [ pctChange() ]
                        │                │                │
                        ▼                ▼                ▼
                  Today vs Yest    Month vs Last    Avg Sale Month
                     Change %         Change %       vs Last Avg %
```

---

## 5. DTO Interface & Schema Contract

### Input Transfer Objects (DTOs)
```text
┌────────────────────────────────────────────────────────────────────────┐
│ CreateSaleDto                                                          │
├────────────────────────────────────────────────────────────────────────┤
│ • partyId:        String (Optional - null for Walk-in Customer)        │
│ • pricingTier:    String (Optional - custom pricing structure)         │
│ • discount:       Number (Optional - defaults to 0)                    │
│ • tax:            Number (Optional - defaults to 0)                    │
│ • paymentMethod:  String (Required - cash, card, mobile_banking, etc.) │
│ • paidAmount:     Number (Optional - defaults to 0)                    │
│ • notes:          String (Optional - description)                      │
│ • items:          Array of CreateSaleItemDto                           │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │ CreateSaleItemDto                                            │     │
│   ├──────────────────────────────────────────────────────────────┤     │
│   │ • itemId:     String (Required)                              │     │
│   │ • batchId:    String (Optional - for manual batch selection) │     │
│   │ • itemName:   String (Optional)                              │     │
│   │ • quantity:   Number (Required)                              │     │
│   │ • unitPrice:  Number (Required)                              │     │
│   │ • discount:   Number (Optional)                              │     │
│   └──────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ EditSaleDto                                                            │
├────────────────────────────────────────────────────────────────────────┤
│ • partyId:        String (Optional)                                    │
│ • pricingTier:    String (Optional)                                    │
│ • discount:       Number (Optional)                                    │
│ • tax:            Number (Optional)                                    │
│ • paymentMethod:  String (Optional)                                    │
│ • paidAmount:     Number (Optional)                                    │
│ • notes:          String (Optional)                                    │
│ • items:          Array of CreateSaleItemDto (Optional - replaces list)│
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ UpdateSaleDto                                                          │
├────────────────────────────────────────────────────────────────────────┤
│ • status:         SaleStatus Enum ('pending','completed','cancelled',  │
│                                    'returned')                         │
│ • notes:          String (Optional)                                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Sale Returns Service (SaleReturnsService) Architectural Blueprint

This section outlines the database relationships, lifecycle transactions, and data structures managed by the `SaleReturnsService`.

### A. Return Relational Topology & Cascades

The return architecture maps the path of incoming returned inventory and the outbound movement of refunds.

```text
               ┌────────────────────────────────────────────────────────┐
               │              HTTP Client / Voice Trigger               │
               └───────────────────────────┬────────────────────────────┘
                                           │ Request (DTO)
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │                 SaleReturnsController                  │
               └───────────────────────────┬────────────────────────────┘
                                           │ Internal Method Call
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   SaleReturnsService                                   │
│                                                                                        │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌──────────────────────────┐  │
│  │     PrismaService      │  │       PinoLogger       │  │   generateReturnNo(tx)   │  │
│  │  (Database Connection) │  │   (Structured Logs)    │  │ (Sequenced Date-Prefix)  │  │
│  └───────────┬────────────┘  └───────────┬────────────┘  └────────────┬─────────────┘  │
│              │                           │                            │                │
│              └───────────────────────────┼────────────────────────────┘                │
│                                          ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                 Service API                                      │  │
│  ├──────────────────────────────────────────────────────────────────────────────────┤  │
│  │ • findAll()     • findOne()     • create()     • update()    • remove() (cancel) │  │
│  └───────────────────────────────────────┬──────────────────────────────────────────┘  │
└──────────────────────────────────────────┼─────────────────────────────────────────────┘
                                           │ Prisma Transaction Client (tx)
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                Database Layer (Prisma)                                 │
│                                                                                        │
│                     ┌─────────────────┐       ┌─────────────────┐                      │
│                     │   SaleReturn    │──────▶│ SaleReturnItem  │                      │
│                     └────────┬────────┘       └────────┬────────┘                      │
│                              │                         │                               │
│        ┌─────────────────────┼───────────┬─────────────┼───────────┐                   │
│        ▼                     ▼           ▼             ▼           ▼                   │
│  ┌───────────┐         ┌───────────┐┌───────────┐┌───────────┐┌───────────┐            │
│  │   Sale    │         │  Account  ││  Payment  ││   Item    ││   Batch   │            │
│  │ (Orig.Ref)│         │ (Debit/-) ││ (Ref.Rec) ││ (Stock+)  ││ (Restock) │            │
│  └─────┬─────┘         └─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘            │
│        │                     │            │            │            │                  │
│        ▼                     ▼            ▼            ▼            ▼                  │
│  ┌───────────┐         ┌───────────┐┌───────────┐┌───────────┐┌───────────┐            │
│  │Party/Ledger│        │ Ledger/Bal││Pay. Record││ StockLedg ││ BatchQty  │            │
│  │ (Credit/+) │        │ (Liquid)  ││ (Auditing)││(Return In)││ (Increment│            │
│  └───────────┘         └───────────┘└───────────┘└───────────┘└───────────┘            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### B. Creating a Sale Return (`create()`)

This transaction validates that the return quantities do not exceed the quantity originally sold (less any previously returned quantities), updates inventory stock (and batch records, if tracked), recalculates the original sale's remaining profit, checks for transition to a fully returned status, updates payment records for refund methods, and credits/debits ledger books.

```text
                     START SaleReturnsService.create(dto)
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   Fetch original Sale &   │
                        │     associated items      │
                        └─────────────┬─────────────┘
                                      │
                        [Sale exists & not cancelled?]
                        /                            \
                     (No)                            (Yes)
                     /                                  \
                    ▼                                    ▼
            ┌──────────────┐                     ┌───────────────────────┐
            │ Throw 404/400│                     │ Validate loop for each│
            │  Exception   │                     │ return item in DTO    │
            └──────────────┘                     └──────────┬────────────┘
                                                            │
                                                            ▼
                                             ┌──────────────────────────────┐
                                   ◄─────────┤ Loop through input items     │◀────────┐
                                   │         └──────────────┬───────────────┘         │
                                   │                        │                        │
                                   │                        ▼                        │
                                   │           ┌──────────────────────────┐          │
                                   │           │ Check item in SaleItems  │          │
                                   │           │ existence & returnedQty  │          │
                                   │           └────────────┬─────────────┘          │
                                   │                        │                        │
                                   │              [Item Valid & Qty <=]              │
                                   │              [  (Qty - returned) ]              │
                                   │              /                  \               │
                                   │          (No)                    (Yes)          │
                                   │          /                          \           │
                                   │         ▼                            ▼          │
                                   │  ┌─────────────┐             ┌──────────────┐   │
                                   │  │  Throw 400  │             │Calculate     │   │
                                   │  │ Bad Request │             │proportional  │   │
                                   │  └─────────────┘             │discount, item│   │
                                   │                              │return total  │   │
                                   │                              └──────┬───────┘   │
                                   │                                     │           │
                                   │                                     ▼           │
                                   │                              ┌──────────────┐   │
                                   │                              │Push return   │   │
                                   │                              │item to list  │   │
                                   │                              │returnItems   │   │
                                   │                              │Add to refund │   │
                                   │                              │subtotal      │   │
                                   │                              └──────┬───────┘   │
                                   │                                     │           │
                                   └─────────────────────────────────────┼───────────┘
                                                                         └───────────(Next Item)

                                    ┌────────────┐
                                    │Loop End    │
                                    └─────┬──────┘
                                          │
                                          ▼
                            ┌───────────────────────────┐
                            │ Begin Database Transaction│
                            └─────────────┬─────────────┘
                                          │
                                          ▼
                            ┌───────────────────────────┐
                            │    Generate Return No     │
                            │      SR-[YYYY]-[Seq]      │
                            └─────────────┬─────────────┘
                                          │
                                          ▼
                            ┌───────────────────────────┐
                            │    Create SaleReturn &    │
                            │    SaleReturnItem recs    │
                            └─────────────┬─────────────┘
                                          │
                                          ▼
                            ┌───────────────────────────┐
                            │ Loop items in Return:     │◀───────┐
                            │ • Increment SaleItem      │        │
                            │   returnedQty             │        │
                            │ • Increment Item          │        │
                            │   currentStock            │        │
                            │ • If batchId exists,      │        │
                            │   increment Batch.remQty  │        │
                            │ • Create StockLedger      │        │
                            │   entry (type: return_in) │        │
                            └─────────────┬─────────────┘        │
                                          │                      │
                                          └──────────────────────┘
                                          (Process all return items)
                                          │
                                          ▼
                            ┌───────────────────────────┐
                            │Recalculate Sale Profit    │
                            │  (subtracting return      │
                            │   portion discount & cost)│
                            └─────────────┬─────────────┘
                                          │
                                          ▼
                            ┌───────────────────────────┐
                            │Check if Sale fully ret    │
                            │ • If all items fully ret: │
                            │   update Sale status to   │
                            │   'returned'              │
                            └─────────────┬─────────────┘
                                          │
                                          ▼
                        [refundMethod && accountId && not CREDIT_NOTE?]
                        /                                             \
                     (Yes)                                            (No)
                     /                                                   \
                    ▼                                                     ▼
        ┌─────────────────────────┐                            [partyId exists?]
        │ Decrement Account bal   │                            /               \
        │ by refundSubtotal       │                         (Yes)              (No)
        │ Create Payment (return) │                          /                    \
        └───────────┬─────────────┘                         ▼                      ▼
                    │                          [CREDIT_NOTE or sale.due > 0?]   ┌───────────┐
                    │                          /                            \   │  Commit   │
                    │                       (Yes)                           (No)│Transaction│
                    │                       /                                  \└─────┬─────┘
                    │                      ▼                                    ▼     │
                    │          ┌───────────────────────┐                  ┌─────────┐ │
                    │          │ Decrement Party bal   │                  │ Commit  │ │
                    │          │ by refundSubtotal     │                  │   Tx    │ │
                    │          │ Create PartyLedger    │                  └─────────┘ │
                    │          │ entry (type: return)  │                              │
                    │          └──────────┬────────────┘                              │
                    └─────────────────────┼───────────────────────────────────────────┘
                                          │
                                          ▼
                                    Log Info & Return
                                   Transformed Return
```

### C. Cancelling/Reversing a Sale Return (`remove()`)

Cancelling a return functions as a soft-deletion that reverses the stock restock and decrements the batch/item quantities that were added during the return.

```text
                     START SaleReturnsService.remove(id)
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │ Fetch existing Return by  │
                        │    id including items     │
                        └─────────────┬─────────────┘
                                      │
                        [Return exists & not cancelled?]
                        /                              \
                     (No)                              (Yes)
                     /                                    \
                    ▼                                      ▼
            ┌──────────────┐                       ┌───────────────────┐
            │ Throw 404/403│                       │ Begin Transaction │
            │  Exception   │                       └─────────┬─────────┘
                                                             │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │ Loop return items │◀──────┐
                                                   │   in transaction  │       │
                                                   └─────────┬─────────┘       │
                                                             │                 │
                                                             ▼                 │
                                                   ┌───────────────────┐       │
                                                   │ Decrement SaleItem│       │
                                                   │ returnedQty by Qty│       │
                                                   └─────────┬─────────┘       │
                                                             │                 │
                                                             ▼                 │
                                                   ┌───────────────────┐       │
                                                   │ Decrement Item    │       │
                                                   │ currentStock      │       │
                                                   └─────────┬─────────┘       │
                                                             │                 │
                                                             ▼                 │
                                                   ┌───────────────────┐       │
                                                   │ If batchId exists,│       │
                                                   │ decrement Batch   │       │
                                                   │ remainingQty      │       │
                                                   └─────────┬─────────┘       │
                                                             │                 │
                                                             ▼                 │
                                                   ┌───────────────────┐       │
                                                   │Create StockLedger │       │
                                                   │entry (adjustment) │       │
                                                   │qty = -item.quantity│       │
                                                   └─────────┬─────────┘       │
                                                             │                 │
                                                             └─────────────────┘
                                                       (Next return item)
                                                             │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │ Update Return DB: │
                                                   │ • status='cancelled'│
                                                   │ • deletedAt=now() │
                                                   └─────────┬─────────┘
                                                             │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │Commit Transaction │
                                                   └─────────┬─────────┘
                                                             │
                                                             ▼
                                                       Log Info & Ret
                                                          Success
```

### D. Return Schemas & Query Contract

#### Input Transfer Objects (DTOs)
```text
┌────────────────────────────────────────────────────────────────────────┐
│ CreateSaleReturnDto                                                    │
├────────────────────────────────────────────────────────────────────────┤
│ • saleId:         String (Required - target original sale)             │
│ • reason:         String (Optional - default reason for return)        │
│ • notes:          String (Optional - additional info)                  │
│ • refundMethod:   RefundMethod Enum (CREDIT_NOTE, CASH, CARD, etc.)    │
│ • accountId:      String (Optional - target financial account)         │
│ • items:          Array of CreateSaleReturnItemDto                     │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │ CreateSaleReturnItemDto                                      │     │
│   ├──────────────────────────────────────────────────────────────┤     │
│   │ • saleItemId: String (Required - reference to SaleItem)      │     │
│   │ • quantity:   Number (Required - quantity returned)          │     │
│   │ • reason:     String (Optional - individual item return res) │     │
│   └──────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ QuerySaleReturnDto                                                     │
├────────────────────────────────────────────────────────────────────────┤
│ • page:           String (Optional - pagination index)                 │
│ • limit:          String (Optional - pagination size limit)            │
│ • saleId:         String (Optional - filter by specific sale)          │
│   partyId:        String (Optional - filter by customer party)         │
│ • status:         String (Optional - filter by return status)          │
│ • reason:         String (Optional - filter by return reason text)     │
│ • startDate:      String (Optional - date boundary start)              │
│ • endDate:        String (Optional - date boundary end)                │
│ • search:         String (Optional - search returnNo or sale invoice)  │
└────────────────────────────────────────────────────────────────────────┘
```
```
