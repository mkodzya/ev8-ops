# Продажа товаров (issue #11)

Источник: запрос директора от 23.10.2026 (GitHub `mkodzya/ev8-ops#11`). Решение Mika «А» от 23.10.2026. Строка в `CLAUDE.md` уже есть (коммит `124fb23`): «Domain facts» — исключение «НДС внутри» для товаров, «Расширения сверх ТЗ» — продажа товаров со ссылкой на этот файл.

Ветка `feature/goods-sales` от `develop`. **Миграция 0067** (одна). В ветке issue #10 миграций нет, она занимает только **ADR-0044**, поэтому здесь **ADR-0045**. Если до слияния кто-то займёт 0067, номер сдвигается.

---

## 0. Коротко

- **Новая запись «Продажа товаров»** `goods_sales` (`TS-00001`) с позициями `goods_sale_lines`. Таблица `sales` (мопед: график, VIN, гарантия) не меняется.
- **Позиция** — одно из двух:
  - позиция склада (`part_id`), списание через `stock_moves issue`;
  - считаемый предмет «Зарядка» (`counted_item`), списание через `battery_moves kind 'sold'`. Батарея работает тем же кодом и включается по слову Mika.
- **Деньги платятся как за ремонт.** Новый `PaymentKind 'goods'`, у платежа `goods_sale_id`. Распределений нет: открыто = итог позиций − сумма живых платежей `goods`. Новой цели `AllocationTarget` нет (почему — §1, п. 8).
- **Цена окончательная, НДС внутри.** `netFromGross` берётся один раз от итога: 100 ₾ = 84,75 + 15,25.
- **Склад.** Продать больше остатка нельзя. Владелец может продать сверх остатка с причиной.
- **Отмена** возвращает товар на остаток. Платёж своего клиента становится его авансом. Платёж розничного покупателя аннулируется с причиной.
- **Отчёты.** Строка «Товары» появляется:
  - в неделе (экран и PDF);
  - в «Сегодня»;
  - в «Платежах» (фильтр «Основание» и `row=goods`).

  В «Экономике» — блок «Товары»: выручка, НДС, себестоимость, маржа.
- **Счёт PDF** на грузинском (`lib/pdf/goodsInvoice.ts`): реквизиты компании, «без НДС / НДС 18 % / итого».

---

## 1. Решения Mika и умолчания

| # | Что | Кто решил | Почему так |
|---|---|---|---|
| 1 | Полный вариант, а не «просто записать деньги» | **Mika «А», 23.10.2026** | — |
| 2 | Цена товара окончательная, НДС 18 % выделяется изнутри. Для аренды и остального НДС остаётся сверху | **Mika «А», 23.10.2026** | Так цену называют клиенту. Запчасть в ремонте за счёт клиента уже идёт по `salePriceTetri` без надбавки НДС |
| 3 | Продать больше остатка нельзя; владелец может продать сверх остатка с причиной, как ремонт уже уходит в минус | умолчание сессии | — |
| 4 | Отмена возвращает товар на остаток. Платёж своего клиента становится авансом, платёж розничного покупателя аннулируется с причиной | умолчание сессии | — |
| 5 | **Зарядка сверх счёта** (только владелец, с причиной): сначала пишется `found` на недостающее, потом `sold`. Счёт остаётся прежним. У запчасти минус пишется как есть | умолчание разработки | `batteryCount` обрезает итог на нуле, и минус у зарядок был бы невидим. Так умолчание 3 работает и для зарядок, а не сужается |
| 6 | **Карта или перевод в мастере** — это «ждёт банк» (`promised_channel`): платёж не создаётся, строку привязывают в «Разобрать». Если строка той же суммы уже пришла, владелец привязывает её тут же, одной транзакцией. Ручной платёж картой из мастера не пишется. Форма денег («Принять деньги») по-прежнему даёт владельцу записать карту | умолчание разработки | TBC присылает карты одной строкой на день по каждой платёжной системе (`parse.ts`). Ручная запись 100 ₾ с такой строкой не совпадёт, и её придётся аннулировать |
| 7 | **Розничный покупатель в долг не берёт.** Он платит наличными сразу или ждёт банк (карта, перевод). В долг можно продать только своему клиенту | умолчание разработки | Карточки нет, долг некому предъявить |
| 8 | **Без новой цели распределения.** Платёж `goods` ссылается на продажу, как платёж `service` на ремонт (`serviceOwed`) | умолчание разработки | Директор предлагал цель. Но у продажи одна сумма, а не график. Так не нужны вторая миграция, правка `allocation_shape`, `writeAllocations` и подписи `settledLabel` |
| 9 | **Продажа задним числом в день последнего пересчёта позиции или раньше** спрашивает: «Пересчёт dd.mm уже не видел этот товар?». «Да» (выбрано заранее) — движения нет, `stock_from = 'count'` | умолчание разработки | Иначе товар спишется дважды. Зарядки считаются по времени записи после пересчёта (`batteriesNow`), запчасти — разницей `adjust` |
| 10 | **Позиции после записи не правятся.** Ошибку исправляют отменой и новой продажей. Владелец правит только имя и телефон покупателя и заметку | умолчание разработки | Счёт уже выдан |
| 11 | **«Отменить» в тосте**: создатель продажи, сервер принимает до 60 с (как `UNDO_MS` платежей), тост держится 10 с (ux №14). Действует без причины, все платежи аннулируются как `undo` | умолчание разработки | Менеджер исправит ошибку без владельца |
| 12 | **«Разобрать».** Правило по имени привязывает к товару, если у клиента ровно одна запись с долгом этой суммы. По одной сумме товары не привязываются, только предлагаются. Открытая продажа товаров той же суммы ±3 дня останавливает правила аренды «сумма + дата» и «карта в день выдачи»: строка ждёт человека | умолчание разработки | ADR-0004: два признака, автоматика предлагает |
| 13 | **Розничный платёж внутри разнесённой строки.** Отменить такую продажу нельзя (`goods_payment_in_split`): сначала строку отвязывают в «Разобрать» | умолчание разработки | `voidPaymentTx` аннулирует все части строки |
| 14 | **Аванс после отмены** раскладывается сразу после записи. Тот же `settleCredit` по открытым арендам клиента, что ночью | умолчание разработки | Неделя клиента погашается в тот же момент |
| 15 | **Одно слово: «Товары»** / «საქონელი» / «Goods» для вида платежа, вкладки и строки отчёта. «Товары / Запчасти» из запроса сведено к одному слову. Запись — «Продажа товаров». Покупатель без карточки — «Розничный покупатель» / «საცალო მყიდველი» | умолчание разработки | ux.md «Одно понятие — одно слово» (issue #9). Если Mika и Kardu хотят двойную подпись — это одна строка на язык |
| 16 | **Календарь «Пришло денег» остаётся календарём аренды**, товаров в нём нет. Товары видны в неделе, «Сегодня» и «Платежах» | умолчание разработки | Там Σ дней = `weekIncome.rentTetri` (`calendar.ts`). Директору сказать |
| 17 | **Продаются зарядки.** Батареи — одной строкой в `SELLABLE_COUNTED`, по слову Mika | умолчание разработки | Директор: «позже батареи» |
| 18 | **Аксессуары заводятся позициями склада**, отдельной категории нет | умолчание разработки | — |
| 19 | **Счёт PDF — бумага покупателю, а не налоговая фактура RS.ge.** Её ведёт Polaris (`handoff.md` §6, п. 6–7; книга `business/money.md`). IBAN в `company.ts` нет, поэтому банковский счёт не печатается. Код покупателя (ს/კ) печатается только у `kind = company` | умолчание; **IBAN — данные от Mika** | Ничего не выдумываем. Личный номер физлица и ИП не уходит на бумагу, которую печатает менеджер (CST-03) |
| 20 | **Себестоимость зарядки** не хранится отдельно. Владелец может ввести её в строке продажи, иначе она неизвестна и в маржу не входит | умолчание разработки | У зарядки нет карточки. Таблица цен по моделям — «позже» |

**Отступления от «Как предлагаю сделать» директора:** п. 8 (нет цели распределения), п. 6 (карта в мастере — строка банка, а не ручной платёж), п. 15 (одно слово), п. 16 (календарь), п. 17–18 (батареи и категория позже). Остальное взято как есть.

---

## 2. Модель данных

### 2.1 `apps/api/migrations/0067_goods_sales.sql`

```sql
-- EV8 Ops — migration 0067: goods sold over the counter (issue #11, ADR-0045;
-- Mika 23.10.2026 «А»). Parts off the shelf and chargers from the count are
-- sold to a customer or to a retail buyer with no card; the shelf and the
-- count go down by themselves; the price is final with VAT inside (an
-- exception to «VAT on top», which stays for rent). A goods sale's money is a
-- payment of its own kind tied to the sale the way a repair's is — no
-- allocation: what is open is the lines' total less its live payments.
--
-- The enum value is only added here; nothing in this file uses it (the file
-- runs in one transaction). The pairing kind = 'goods' ⇔ goods_sale_id is the
-- code's to keep, as 0066 keeps 'offset'; a cancelled own customer's payment
-- keeps goods_sale_id after it became his credit (on_account).

ALTER TYPE payment_kind ADD VALUE IF NOT EXISTS 'goods';

CREATE SEQUENCE IF NOT EXISTS goods_sale_number_seq;

CREATE TABLE goods_sales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number           text NOT NULL UNIQUE DEFAULT ('TS-' || lpad(nextval('goods_sale_number_seq')::text, 5, '0')),
  sold_on          date NOT NULL,
  -- NULL: a retail buyer with no card; a name and a phone may be said.
  customer_id      uuid REFERENCES customers(id),
  buyer_name       text,
  buyer_phone      text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  -- What was not paid at the counter comes from the bank (ADR-0045 §6).
  promised_channel text CHECK (promised_channel IN ('acquiring', 'transfer')),
  backdate_reason  text,
  notes            text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES users(id),
  cancel_reason    text,
  CONSTRAINT goods_sales_buyer_ck CHECK (customer_id IS NULL OR (buyer_name IS NULL AND buyer_phone IS NULL)),
  CONSTRAINT goods_sales_cancel_ck CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND btrim(coalesce(cancel_reason, '')) <> ''))
);
CREATE INDEX goods_sales_customer_idx ON goods_sales(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX goods_sales_sold_idx ON goods_sales(sold_on DESC, created_at DESC);

CREATE TABLE goods_sale_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id           uuid NOT NULL REFERENCES goods_sales(id) ON DELETE CASCADE,
  seq               smallint NOT NULL CHECK (seq BETWEEN 1 AND 20),
  part_id           uuid REFERENCES parts(id),
  counted_item      text CHECK (counted_item IN ('charger', 'battery')),
  -- As sold, for the invoice: the part's names that day, or «Зарядка 73V6A».
  name              text NOT NULL CHECK (btrim(name) <> ''),
  name_ka           text,
  -- A counted item's model as the seller typed it ("73V6A").
  spec              text,
  qty               integer NOT NULL CHECK (qty BETWEEN 1 AND 999),
  -- Final, VAT inside (ADR-0045).
  unit_price_tetri  integer NOT NULL CHECK (unit_price_tetri > 0),
  -- What the shelf offered; differs from the price — the price was edited (journal).
  shelf_price_tetri integer CHECK (shelf_price_tetri >= 0),
  -- One unit's cost that day: the shelf's average, the last paid receipt, the owner's figure; NULL — unknown.
  unit_cost_tetri   integer CHECK (unit_cost_tetri >= 0),
  -- 'shelf': this sale took it off; 'count': a stocktake already saw it gone.
  stock_from        text NOT NULL DEFAULT 'shelf' CHECK (stock_from IN ('shelf', 'count')),
  -- Sold beyond the count: the owner's words.
  short_reason      text,
  CONSTRAINT goods_sale_lines_seq UNIQUE (sale_id, seq),
  CONSTRAINT goods_sale_lines_one_item CHECK ((part_id IS NULL) <> (counted_item IS NULL)),
  CONSTRAINT goods_sale_lines_spec CHECK (spec IS NULL OR counted_item IS NOT NULL)
);
CREATE UNIQUE INDEX goods_sale_lines_part_once ON goods_sale_lines(sale_id, part_id) WHERE part_id IS NOT NULL;
CREATE UNIQUE INDEX goods_sale_lines_item_once ON goods_sale_lines(sale_id, counted_item, lower(coalesce(spec, ''))) WHERE counted_item IS NOT NULL;
CREATE INDEX goods_sale_lines_part_idx ON goods_sale_lines(part_id) WHERE part_id IS NOT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS goods_sale_id uuid REFERENCES goods_sales(id);
CREATE INDEX IF NOT EXISTS payments_goods_sale_idx ON payments(goods_sale_id) WHERE goods_sale_id IS NOT NULL;

-- The shelf: an issue at the sale, a return at its cancellation — one of each per line.
ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS goods_sale_line_id uuid REFERENCES goods_sale_lines(id);
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_goods_shape
  CHECK (goods_sale_line_id IS NULL OR (kind IN ('issue', 'return') AND service_part_id IS NULL AND purchase_line_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS stock_moves_goods_line_unique ON stock_moves(goods_sale_line_id, kind) WHERE goods_sale_line_id IS NOT NULL;

-- The count: sold, back after a cancellation, and 'found' when an owner sells beyond the count.
ALTER TABLE battery_moves DROP CONSTRAINT IF EXISTS battery_moves_kind_check;
ALTER TABLE battery_moves ADD CONSTRAINT battery_moves_kind_check
  CHECK (kind IN ('to_repair', 'from_repair', 'lost', 'found', 'sold', 'sale_cancelled'));
ALTER TABLE battery_moves ADD COLUMN IF NOT EXISTS goods_sale_line_id uuid REFERENCES goods_sale_lines(id);
ALTER TABLE battery_moves ADD CONSTRAINT battery_moves_goods_shape
  CHECK (kind NOT IN ('sold', 'sale_cancelled') OR goods_sale_line_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS battery_moves_goods_line_unique ON battery_moves(goods_sale_line_id, kind) WHERE goods_sale_line_id IS NOT NULL;

-- The invoice, kept as issued (ADR-0003).
ALTER TABLE files ADD COLUMN IF NOT EXISTS goods_sale_id uuid REFERENCES goods_sales(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS files_goods_sale_idx ON files(goods_sale_id) WHERE goods_sale_id IS NOT NULL;
-- A PDF belongs to a rental, a sale — or now a goods sale (0024's rule, widened).
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_owner;
ALTER TABLE files ADD CONSTRAINT files_owner CHECK (
  (kind = 'act_photo'         AND act_id IS NOT NULL AND customer_id IS NULL) OR
  (kind = 'customer_document' AND customer_id IS NOT NULL AND act_id IS NULL) OR
  (kind = 'service_photo'     AND service_job_id IS NOT NULL) OR
  (kind = 'pdf'               AND doc_kind IS NOT NULL AND (rental_id IS NOT NULL OR sale_id IS NOT NULL OR goods_sale_id IS NOT NULL))
);
```

Миграция только добавляет: боевые строки она не трогает, сида нет, в DEMO ничего не добавляется. Правило `files_owner` (0024) расширено: PDF может принадлежать и продаже товаров. Имя `battery_moves_kind_check` — автоимя встроенного CHECK из 0021. Миграция 0044 добавила колонку `item`, а этот CHECK не меняла.

Чего база не проверяет, проверяет код (`lib/goods.ts`, `lib/money.ts`, `statements/import.ts`):
- у платежа `kind = 'goods'` всегда есть `goods_sale_id`;
- `battery_moves.item` совпадает с `counted_item` строки продажи.

### 2.2 Prisma (`apps/api/prisma/schema.prisma`)

```prisma
enum PaymentKind { rent sale service on_account deposit_payout buyback supplier
  /// A goods sale's money (0067, ADR-0045): no allocation — open is the lines' total less these.
  goods
  @@map("payment_kind") }

/// Parts and chargers sold over the counter (0067, ADR-0045). Price final, VAT inside.
model GoodsSale {
  id              String    @id @default(uuid()) @db.Uuid
  number          String    @unique @default(dbgenerated("('TS-' || lpad(nextval('goods_sale_number_seq')::text, 5, '0'))"))
  soldOn          DateTime  @map("sold_on") @db.Date
  /// Null: «Розничный покупатель», no card.
  customerId      String?   @map("customer_id") @db.Uuid
  buyerName       String?   @map("buyer_name")
  buyerPhone      String?   @map("buyer_phone")
  /// 'active' | 'cancelled'
  status          String    @default("active")
  /// 'acquiring' | 'transfer': the rest comes from the bank.
  promisedChannel String?   @map("promised_channel")
  backdateReason  String?   @map("backdate_reason")
  notes           String?
  createdById     String?   @map("created_by") @db.Uuid
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @default(now()) @map("updated_at")
  cancelledAt     DateTime? @map("cancelled_at")
  cancelledById   String?   @map("cancelled_by") @db.Uuid
  cancelReason    String?   @map("cancel_reason")

  customer    Customer?       @relation(fields: [customerId], references: [id])
  createdBy   User?           @relation("goods_sale_created_by", fields: [createdById], references: [id])
  cancelledBy User?           @relation("goods_sale_cancelled_by", fields: [cancelledById], references: [id])
  lines       GoodsSaleLine[]
  payments    Payment[]
  documents   StoredFile[]

  @@map("goods_sales")
}

model GoodsSaleLine {
  id              String  @id @default(uuid()) @db.Uuid
  saleId          String  @map("sale_id") @db.Uuid
  seq             Int     @db.SmallInt
  partId          String? @map("part_id") @db.Uuid
  /// 'charger' | 'battery' (ADR-0025); exactly one of partId / countedItem.
  countedItem     String? @map("counted_item")
  name            String
  nameKa          String? @map("name_ka")
  spec            String?
  qty             Int
  unitPriceTetri  Int     @map("unit_price_tetri")
  shelfPriceTetri Int?    @map("shelf_price_tetri")
  unitCostTetri   Int?    @map("unit_cost_tetri")
  /// 'shelf' | 'count'
  stockFrom       String  @default("shelf") @map("stock_from")
  shortReason     String? @map("short_reason")

  sale         GoodsSale     @relation(fields: [saleId], references: [id], onDelete: Cascade)
  part         Part?         @relation(fields: [partId], references: [id])
  stockMoves   StockMove[]
  batteryMoves BatteryMove[]

  @@unique([saleId, seq])
  @@map("goods_sale_lines")
}
```

К существующим моделям добавляется:
- `Payment.goodsSaleId` + `goodsSale GoodsSale?`;
- `StockMove.goodsSaleLineId` + связь;
- `BatteryMove.goodsSaleLineId` + связь;
- `StoredFile.goodsSaleId` + связь (`onDelete: Cascade`);
- обратные связи `Customer.goodsSales`, `Part.goodsSaleLines`, две именованные у `User`.

### 2.3 Что не хранится, а считается

| Величина | Как |
|---|---|
| Итог продажи | `Σ qty × unit_price_tetri`. Строки после записи не меняются |
| Оплачено | `Σ gross` живых платежей с `goods_sale_id` и `kind = 'goods'` |
| Открыто | итог − оплачено у активной продажи, у отменённой 0. Считает `goodsOwed(tx, id)` в `lib/goods.ts`, по образцу `serviceOwed` |
| НДС и сумма без НДС | `netFromGross(итог)` один раз на продажу; по строкам — `goodsLineNets` |
| Остатки | как раньше: `stockState` и `batteryCount` по движениям |

---

## 3. Shared: чистые функции

### 3.1 Новый `packages/shared/src/goods.ts`, экспорт из `index.ts`

| Функция | Что | Тесты (`packages/shared/test/goods.test.ts`) |
|---|---|---|
| `SELLABLE_COUNTED = ['charger']`, `GOODS_MAX_LINES = 20` | батарея — по слову Mika | — |
| `goodsLineTetri(l)`, `goodsTotals(lines) → {grossTetri, netTetri, vatTetri}` | НДС извлекается один раз из суммы | 10000 → 8475 + 1525; 3500 → 2966 + 534; 3 × 3333 → 8474 + 1525; пусто → 0; `net + vat === gross` на 1000 случайных |
| `goodsLineNets(lines)` | сумма без НДС по строкам методом наибольшего остатка, `Σ` = net продажи | три строки по 33,33; одна строка |
| `goodsSaleState({status, totalTetri, paidTetri, promisedChannel, retail})` | `{state: 'paid' \| 'waiting_bank' \| 'owes' \| 'cancelled', openTetri}` | оплачено; розница с обещанием; свой без обещания → `owes`; отменённая → open 0 |
| `needsCountAnswer(soldOn, lastCountOn, today)` | `lastCountOn != null && soldOn < today && soldOn <= lastCountOn` | сегодня → нет; 08.10 при пересчёте 15.10 → да; 16.10 → нет; пересчётов не было → нет; день в день → да |
| `stockDecision({asked, available, counted, owner, shortReason, countedAlready})` | `already_counted` \| `ok` \| `refuse` \| `need_reason` \| `minus` (запчасть) \| `found_then_sold` (зарядка) | все шесть ветвей |
| `paymentProblem({retail, totalTetri, paidNowTetri, promisedChannel})` | `null` \| `'retail_must_pay'` \| `'goods_paid_over'` | розница без оплаты и обещания; переплата; свой клиент частично → null |
| `priceEdited(shelfPriceTetri, unitPriceTetri)` | у склада есть цена, и она другая | цены склада нет → не правка |
| `cancelPlan({retail, mode: 'cancel' \| 'undo', payments: [{id, inSplit}]})` | по каждому платежу `credit` или `void`, либо `{refuse: 'goods_payment_in_split'}` | свой → `credit`; розница → `void`; `undo` → всегда `void`; розница в разнесённой строке → отказ |
| `goodsEconomics(lines, period)` | по дню продажи, только активные: выручка с НДС, НДС, без НДС, себестоимость, маржа = без НДС − себестоимость (только строки с ценой); `unknownCost {lines, netTetri}`; `byItem` | отменённые и вне периода не считаются; строка без себестоимости не равна 0; `byItem` складывается в итог |
| `countedName(item, spec) → {ru, ka, en}` | «Зарядка 73V6A» / «დამტენი 73V6A» / «Charger 73V6A» | со spec и без |

### 3.2 Правки соседних модулей

- **`week.ts`**
  - `WeekPaymentKind` += `'goods'`.
  - `INCOME_ROWS` += `'goods'`.
  - `WeekIncome.goodsTetri`; `weekIncome` и `incomeRows` его суммируют.
  - `PAYMENT_FILTERS` += `'goodsSaleId'`.
  - В `paymentInRow` два тернарника заменяются исчерпывающими `Record<WeekAllocationTarget, IncomeRow>` и `Record<WeekPaymentKind, IncomeRow | null>`, где `goods → 'goods'`. Тогда следующий новый вид назовёт компилятор. Сейчас неизвестный вид даёт `null`, и неделя молча не сходится.
  - Тест: зарядка 100 картой → `goodsTetri` 10000, `acquiringFeeTetri` 150, `totalTetri === incomeRows`. Платёж, переписанный в `on_account`, → строка `rent`.
- **`debt.ts`**
  - `DebtInput.goods: {id, number, chargedTetri, paidTetri}[]` (только активные).
  - `DebtPart.kind` += `'goods'`.
  - Тест: открытая продажа — часть долга; аванс её гасит; отменённая не считается.
  - `due.ts` не меняется: часть `goods` — старый долг (тест подтверждает).
- **`batteries.ts`**
  - `BatteryMove.kind` += `'sold' | 'sale_cancelled'`.
  - `total = inv.total − lost + found − sold + sale_cancelled`.
  - Тест: продажа −1 в шоуруме, отмена +1, `found` + `sold` оставляют счёт прежним, курьеры не трогаются.
- **`permissions.ts`**: `'goods.sell'` (продать товар у стойки) в `PERMISSIONS` и `MANAGER`. В `PIN_SESSION_PERMISSIONS` не добавляется.
- **`navigation.ts`**
  - `TabId` += `'goods'`.
  - `SECTION_TABS.sales`: `{vehicles, '/sales'}`, `{goods, '/sales/goods'}`, оба `fleet.view`. `vehicles` уже подписан «Мопеды».
  - `ActionId` += `'sellGoods'` → `/sales/goods/new`, `anyOf: ['goods.sell']`.
  - Тест: у менеджера в «＋» есть «Продать товар» и нет «Продать мопед».
- **`journal.ts`**
  - `EVENT_ACTIONS` += `'goods_sale.create'`, `'goods_sale.invoice'`.
  - `MONEY_PREFIXES` += `'goods_sale.'`.
  - `looksLikeNumber` знает `TS`.
- **`search.ts`** не меняется: хватает `numberMatches`, `spellingMatches`, `phoneMatches`.

---

## 4. Деньги

### 4.1 `apps/api/src/lib/money.ts`

- `MONEY_KINDS` += `'goods'` (направление `in`); `MoneyInput.goodsSaleId`; `Closes.target` += `'goods'`.
- `planMoney`, ветка `case 'goods'`:
  - продажи нет → `goods_sale_not_found`; отменена → `goods_sale_closed`;
  - `gross > open` → 409 `goods_over_open {number, openTetri}`. Код `over_open` занят ремонтом, текст у него про ремонт;
  - результат: `closes: [{target: 'goods', amountTetri: gross, fullTetri: total, openTetri, number}]`, `limitTetri: open`.
- `FROM_CUSTOMER` += `'goods'`. `payerOf` для goods → `goodsSale.customerId`. У розницы это `null`, а `inBankAlready` с `null` показывает только ждущие строки, которые никого не называют.
- `writeOther`, ветка `case 'goods'`: `customerId = sale.customerId`, `goodsSaleId`. Журнал `payment.goods`. Сейчас неизвестный вид падает с ошибкой `not written here`.
- **Рефактор:** выносится `recordMoneyTx(tx, actor, input)`, а `recordMoney` = `prisma.$transaction(tx => recordMoneyTx(...))`. Так продажа и «Оплачено сейчас» пишутся одной транзакцией. Остальные виды ведут себя как раньше, это закрепляет полный прогон тестов API.
- `checkMoney` не меняется: менеджер принимает только наличные и только сегодня.
- Комиссия: `feeFor` уже даёт 1,5 % на входящую карту. Продажа гасится по gross, комиссия идёт в строку недели «Комиссия эквайринга».

### 4.2 `apps/api/src/lib/payments.ts`

- Новая `rebookToCredit(tx, {paymentId, actorId, reason})`:
  - проверяет: `kind 'goods'`, платёж не аннулирован, есть `customerId`;
  - ставит `kind 'on_account'`, `goods_sale_id` оставляет как происхождение, строку банка и части разнесения не трогает;
  - журнал `payment.rebook` (было `{kind:'goods', goodsSaleId}`, стало `{kind:'on_account'}`, note — причина).
- `voidPaymentTx` и `voidOne` не меняются: у товаров нет ни распределений, ни пересчёта.

### 4.3 Отмена: что становится с деньгами

Решение принимает `cancelPlan` (shared), пишет `cancelGoodsSaleTx` (§6.3).

- **Свой клиент:** `rebookToCredit`. После коммита — `settleCredit` по каждой открытой аренде клиента, тот же вызов, что ночью. Что не легло на недели, остаётся авансом. `debtOf` видит аванс сразу: `on_account` без распределений уменьшает общую цифру долга.
- **Розничный покупатель:** `voidPaymentTx(tx, {reason: 'TS-… cancelled: …'})`. Строка банка возвращается в «Разобрать» (B2-07), наличные уходят из кассы того, кто их принял.
- **Розничный платёж — часть разнесённой строки** (у строки больше одного живого платежа): отказ `goods_payment_in_split {paymentId, lineId}` до любых записей.

---

## 5. Склад и зарядки

- **`apps/api/src/lib/stock.ts`**
  - `shelfCost(tx, partId)` переносится из `routes/service.ts:shelfPrice`: средняя по полке, иначе последняя оплаченная приёмка, иначе `null`. Ремонт и продажа берут себестоимость одной функцией.
  - `partOnHandTx(tx, partId)` — `stockState` внутри транзакции. Сейчас `partRows` читает вне её.
  - `lastCountOn(tx, partId)` — последний `adjust` или `receipt` с причиной `'initial'`.
  - `issueForGoodsLine` пишет `issue`, `qty −n`, `unit_cost_tetri NULL`: среднюю снимает `stockState`, как `issueForServicePart`.
  - `returnGoodsLine` пишет `return`, `qty +n`, `unit_cost_tetri` = снимок строки, как `returnServiceParts`. Если снимка нет — средняя полки.
- **`apps/api/src/routes/batteries.ts`**
  - `batteriesNow(item, db = prisma)` принимает клиента транзакции; `lastCountOn` = последний `battery_inventories.counted_on` по `item`.
  - `GET /api/batteries`: у движений `sold`, `sale_cancelled` и `found` от продажи — номер TS и ссылка.
  - `POST /api/batteries/moves` по-прежнему не принимает `sold` и `sale_cancelled`: их пишет только продажа.
- **Гонка за последнюю штуку.** Внутри транзакции по каждой позиции, в порядке ключей, берётся `pg_advisory_xact_lock(hashtext('goods:' || key))`, где ключ — `part:<id>` или `charger`. Остаток считается после блокировки.

---

## 6. API

### 6.1 Маршруты

Новый `apps/api/src/routes/goodsSales.ts` (регистрируется в `server.ts`), логика — в новом `apps/api/src/lib/goods.ts`. Записи принимают `Idempotency-Key` (`lib/operations.ts`).

| Метод и путь | Scope | Что |
|---|---|---|
| `GET /api/goods-sales/items?q=` | `goods.sell` | Что можно продать. Запчасти (не в архиве): `{partId, name, nameKa, sku, unit, onHand, salePriceTetri, lastCountOn}`. Считаемые из `SELLABLE_COUNTED`: `{item, showroom, lastCountOn}`. Себестоимость — только при `cost.view` |
| `POST /api/goods-sales/preview` | `goods.sell` | Тело как у создания, ничего не пишет. Ответ: `totals`; по строкам `available`, `decision`, `needsCountAnswer`, `lastCountOn`, `shelfPriceTetri`, `priceEdited`, себестоимость (при `cost.view`); `paymentProblem`; `inBank` — строки банка ±3 дня (`inBankAlready`), у которых сумма клиента ровно та, что оставлена банку (итог минус наличные), для владельца при карте или переводе. Ищутся от этой суммы, а не от открытого после выбранной строки — выбранная строка остаётся в списке. Перевод на сумму нетто карты и карта, чья нетто равна итогу, не предлагаются: первая оставила бы 1,5 % открытыми, вторая заплатила бы сверх продажи |
| `POST /api/goods-sales` | `goods.sell` | Продать (§6.2) → `201 {id, number, paymentId?, openTetri}` |
| `GET /api/goods-sales?status=&open=1&retail=1&customerId=&partId=&item=&from=&to=&q=` | `fleet.view` | Строки: `{id, number, soldOn, status, customer \| null, buyer \| null, items, totalTetri, paidTetri, openTetri, state}`; шапка `{openTetri, count}` |
| `GET /api/goods-sales/:id` | `fleet.view` | Карточка: строки (себестоимость и маржа при `cost.view`), `totals` с НДС, платежи с судьбой (`paid` / `credit` / `voided`) и строкой банка, документы, лента (журнал `goods_sale` + платежи), `bankLines` (владельцу при открытом > 0), `can {pay, cancel, undo, edit}` |
| `PATCH /api/goods-sales/:id` | `sales.manage` | `buyerName`, `buyerPhone` (только у розничной), `notes`. Правка покупателя отправляет выданный счёт в архив. Журнал `goods_sale.update` |
| `GET /api/goods-sales/:id/cancel-plan` | `sales.manage` | `?countedBack=1` — ответ владельца о строках `stock_from 'count'`. Что вернётся на склад (было → станет; строка пересчёта без ответа «вернулся» — «остаток не меняется»), судьба каждого платежа, какие недели погасит аванс (`planMoney on_account`, только чтение), какие строки банка вернутся в «Разобрать» |
| `POST /api/goods-sales/:id/cancel` | `sales.manage` | `{reason, countedBack?}` → §6.3 |
| `POST /api/goods-sales/:id/undo` | `goods.sell` | Только создатель, ≤ 60 с, без причины → §6.3, режим `undo` |
| `GET /api/goods-sales/:id/invoice.pdf` | `goods.sell` | §8. Первая выдача сохраняется (`files.doc_kind 'goods_invoice'`, журнал `goods_sale.invoice`), потом отдаётся сохранённое. После отмены или правки покупателя — новая копия, старая в архиве. Маршрут в `routes/documents.ts`, рядом с `contract.pdf` продажи |
| `GET /api/economics/goods?from=&to=` | `reports.view` | `goodsEconomics`; по умолчанию текущий месяц (`monthOf`) |
| `POST /api/money`, `/api/money/preview` | `cash.record` | `kind: 'goods', goodsSaleId`. Деньги за уже созданную продажу — через одну форму денег (ux №5), отдельного маршрута нет |
| `POST /api/statement-lines/:id/assign` | `payments.reconcile` | += `goodsSaleId` |
| `POST /api/statement-lines/:id/split` | `payments.reconcile` | часть += `goodsSaleId` |
| `GET /api/customers/:id/money-targets` | `cash.record` | += `goods: [{id, number, openTetri, soldOn, items}]` |
| `GET /api/customers/:id` | `fleet.view` | += `goodsSales` (покупки); номер TS в ленте |
| `GET /api/parts/:id` | `fleet.view` | у движений `sale {id, number}`; блок `sales` — последние 50 строк (маржа при `cost.view`) |
| `GET /api/search` | `fleet.view` | группа `goods`: номер TS, имя клиента, имя или телефон розничного покупателя, название позиции → `{id, number, status, buyer, customerId, openTetri}` |

### 6.2 `POST /api/goods-sales` — одна транзакция

```json
{
  "soldOn": "2026-10-08", "backdateReason": "введено задним числом (пример)",
  "customerId": null, "buyerName": null, "buyerPhone": null,
  "lines": [
    { "partId": "…", "qty": 1, "unitPriceTetri": 3500, "shortReason": null, "countedAlready": null },
    { "countedItem": "charger", "spec": "73V6A", "qty": 1, "unitPriceTetri": 10000, "unitCostTetri": null, "countedAlready": true }
  ],
  "paidNow": { "channel": "cash", "amountTetri": 3500 },
  "promisedChannel": null,
  "notes": null
}
```

`paidNow` — одно из двух:
- `{channel: 'cash', amountTetri}`;
- `{statementLineId}` — строка банка, только владелец.

Шаги:

1. **Проверки вне транзакции.**
   - 1–20 строк, `qty` от 1 до 999. В строке ровно одно из `partId` / `countedItem` (`goods_line_bad`). `countedItem` только из `SELLABLE_COUNTED` (`goods_item_not_sellable`).
   - Позиция существует (`goods_item_not_found`) и не в архиве (`goods_item_archived`). Одна позиция дважды → `goods_same_item`.
   - Цена ≥ 1 тетри, иначе `missing_field lines[i].unitPriceTetri`. `unitCostTetri` — только с `cost.view`, иначе `owner_only`.
   - Покупатель: клиент существует (`customer_not_found`), не объединён (`customer_archived`); для розницы имя ≤ 200, телефон ≤ 40.
   - Дата: `soldOn > today` → `future_date`; `soldOn < today` → только `sales.manage` (`owner_only_backdate`) и с причиной (`missing_field backdateReason`).
   - `paymentProblem`. Для наличных — `checkMoney`; дата платежа = `soldOn`, причина задней даты общая.
2. **Блокировки** (§5), затем остатки внутри транзакции.
3. **По каждой строке.**
   - `needsCountAnswer` и нет ответа → 400 `goods_count_answer {field, lastCountOn}`.
   - Затем `stockDecision`:
     - `refuse` → 409 `goods_short {lines: [{index, available, asked}]}`;
     - `need_reason` → `missing_field lines[i].shortReason`.
4. **Снимки.**
   - `shelf_price_tetri = parts.sale_price_tetri`.
   - `unit_cost_tetri = shelfCost`, у зарядки — введённое владельцем или `null`.
   - `name` и `name_ka` с карточки на этот день, у зарядки — `countedName`.
5. **Запись.**
   - `goods_sales`, строки.
   - Движения с `occurred_on = soldOn` и `reason 'TS-…'`:
     - `ok` / `minus` → `issueForGoodsLine`;
     - зарядка `ok` → `battery_moves sold`;
     - `found_then_sold` → `found` (shortBy, `reason = shortReason`, ссылка на строку), затем `sold`;
     - `already_counted` → движения нет, `stock_from 'count'`.
6. **«Оплачено сейчас».**
   - `statementLineId` → `attach(tx, {lineId, rule: 'by_hand', goodsSaleId})`, проверка `goods_over_open`.
   - Иначе наличные → `recordMoneyTx(tx, actor, {kind: 'goods', goodsSaleId, ...})`.
   - `promised_channel` сохраняется только при остатке > 0.
7. **Журнал.**
   - `goods_sale.create`: after `{number, soldOn, customerId | retail, lines: [{name, qty, unitPriceTetri, shelfPriceTetri, stockFrom}], totalTetri, vatTetri, paidNow, promisedChannel}`, note = причина задней даты.
   - На каждую строку с правленой ценой — `goods_sale.price` (`{seq, unitPriceTetri: цена склада}` → `{seq, unitPriceTetri}`): один ключ с обеих сторон, иначе журнал не покажет «было → стало».
   - На каждую строку сверх остатка — `goods_sale.minus` (`{seq, qty: было}` → `{seq, qty: продано}`, note = причина).

### 6.3 Отмена и «Отменить сразу» — одна транзакция (`cancelGoodsSaleTx(mode)`)

1. `SELECT … FOR UPDATE` на продаже; не `active` → `goods_sale_closed`. Для `undo` дополнительно: создатель и ≤ 60 с, иначе `goods_undo_too_late`.
2. `cancelPlan`: если отказ, то `goods_payment_in_split`.
3. **Товар вернулся физически сейчас** — по каждой строке `stock_from 'shelf'`, с датой «сегодня»:
   - запчасть → `returnGoodsLine`;
   - зарядка → `battery_moves sale_cancelled`.

   Строка `stock_from 'count'` ничего не списала, поэтому сама не возвращается (ревью 23.10.2026): отмена — это и способ исправить ошибку записи (§1 п. 10), и отменённая и записанная заново продажа задним числом иначе подняла бы остаток без товара. `undo` её не возвращает никогда — он снимает только то, что записала продажа. `cancel` возвращает её, только если владелец ответил в листе отмены «Пересчёт уже не видел этот товар. Он вернулся?» — «Да» (`countedBack: true`); заранее выбрано «Нет». Журнал называет невозвращённое `kept: [{name, qty}]`.
4. **Деньги** — §4.3. В режиме `undo` все платежи аннулируются как `kind 'undo'` с причиной «отменено сразу».
5. `status 'cancelled'`, `cancelled_at`, `cancelled_by`, `cancel_reason` (для `undo` — «отменено сразу»). Выданный счёт уходит в архив; при следующем запросе печатается со штампом отмены.
6. Журнал `goods_sale.cancel` или `goods_sale.undo`: было `{status: 'active', paidTetri, openTetri}`, стало `{status: 'cancelled', returned: [{name, qty}], payments: [{id, fate}]}`, note = причина.
7. После коммита — `settleCredit` по открытым арендам клиента, если хоть один платёж стал авансом.

---

## 7. «Разобрать»

**`lib/statements/reconcile.ts`**
- В `Ctx` добавляется `goods: GoodsCand[]` — активные продажи с открытым > 0: `{id, number, customerId | null, customer` (имя клиента или «Розничный покупатель …»)`, names, openTetri, soldOn, promisedChannel}`.
- `loadCtx` читает их одним запросом. В `payments.select` добавляется номер `goodsSale`, чтобы ручной платёж за товар показывался с TS.
- `decide`, правило 1 (имя): кандидаты клиента — `rentals`, `sales` и `goods`, где `customerId === c.id && openTetri === gross`. Ровно один → `RuleTarget {goodsSaleId}`. Два и больше → очередь: аренда той же суммы больше не забирает деньги за товар.
- `decide`, перед правилом 2: есть открытая продажа товаров с `openTetri === gross` и `|soldOn − line.occurredOn| ≤ 3` → `queue`. Правила «сумма + дата» и «карта в день выдачи» тогда не срабатывают.
- По одной сумме товары не привязываются никогда.
- `suggest`:
  1. товары названного банком клиента (причина `name`);
  2. товары той же суммы ±3 дня — сразу после «карта в день выдачи», выше аренд «по сумме». Причина `goods {number, debtTetri, day, channel}`, обещанный канал совпадает со строкой — выше в списке;
  3. товары той же суммы вне окна — в конце.
- `Suggestion.kind` += `'goods_sale'`, `Reason.code` += `'goods'`.

**`lib/statements/import.ts`**
- `LineTarget.goodsSaleId`.
- `paymentOf`: ветка `goodsSaleId` по образцу `serviceJobId` — `payment {kind 'goods', goods_sale_id, customer_id: sale.customerId, channel и fee из moneyOf, source 'statement'}`. Если `gross > open` → 409 `goods_over_open`. Так строку нельзя привязать сверх долга ни руками, ни правилом.
- `attach`: в журнал добавляется `goodsSaleId`.
- `split`: `named` += `['goods', p.goodsSaleId]`; до `claim` проверка `split_over_goods {number, openTetri}`, как у ремонта; в журнал частей `goodsSaleId`.
- `ingest` передаёт `goodsSaleId` из правила в `attach`.
- У ремонта при привязке целой строки проверки «больше долга» нет, она есть только при разнесении. Это отмечено отдельно и молча не чинится.

**`lib/statements/inBank.ts`**: номер платежа берётся как `?? own.goodsSale?.number`.

**`routes/statements.ts`**: `assign` и `split.parts[]` принимают `goodsSaleId`; в `by-rules` номер и ссылка на `/sales/goods/:id`.

**UI `pages/money/SortPage.tsx`**
- `LineCard`: подсказка `goods_sale` → `{goodsSaleId}`. Текст: «TS-00001 · Розничный покупатель · ждёт 100 ₾ · продано 08.10 · картой». Кнопка «Привязать к TS-00001».
- `OtherSheet` («Куда привязать»): группа `goods` из поиска, только открытые.
- `SplitSheet` («Разнести»):
  - у выбранного клиента часть «Товары TS-…» из `money-targets.goods` видна сразу (`extra: false`), `owesTetri` = открытое, в итоге `resGoods`;
  - за «＋ ещё» — открытые розничные продажи (`GET /api/goods-sales?open=1&retail=1`);
  - на первом экране, рядом с поиском клиента, есть выбор «Розничные продажи товаров». Он нужен для дневной строки карт TBC, в которой несколько покупок.

---

## 8. Счёт PDF — `apps/api/src/lib/pdf/goodsInvoice.ts`

`renderGoodsInvoice(d): Promise<Buffer>` на `newDoc`, `h1`, `field`, `rule`, `signatures`, `stampPages`, `DISCLAIMER`, `COMPANY`, `dmy` и вшитом Noto Sans Georgian (ADR-0003). Грузинский — главный язык, английский — мелко серым. Деньги всегда с двумя знаками: новый `gel2` в `company.ts`, потому что `gel` печатает «100».

1. **Шапка.** «ინვოისი / Invoice», «№ TS-00001 · 08/10/2026». У отменённой продажи — полоса «გაუქმებულია · Cancelled · dd/mm/yyyy» и причина мелко.
2. **Две колонки.**
   - «გამყიდველი / Seller»: `COMPANY.nameKa`, «ს/კ 412785721», адрес, директор.
   - «მყიდველი / Buyer»:
     - розница → «საცალო მყიდველი / Retail buyer» + имя и телефон, если сказаны;
     - клиент → имя, телефон, адрес; «ს/კ» только у `kind = company`.
3. **Таблица.** Колонки: № · «დასახელება / Item» (`name_ka ?? name`) · «ერთ. / Unit» · «რაოდ. / Qty» · «ფასი დღგ-ს ჩათვლით / Price incl. VAT» · «თანხა / Amount».
4. **Итоги** (`goodsTotals`):
   - «ჯამი დღგ-ს გარეშე / Total excl. VAT 84.75»;
   - «დღგ 18% / VAT 18% 15.25»;
   - **«სულ გადასახდელი / Total incl. VAT 100.00»**.
   - Ниже: «ფასები მოიცავს დღგ-ს / Prices include VAT».
5. **Подвал.** «გაცემულია / Issued by», подписи продавца и покупателя, `DISCLAIMER`, колонтитул `COMPANY.nameEn · TS-00001 · дата`.
6. **Не печатается:**
   - банковский счёт — IBAN в `company.ts` нет, строка появится, когда Mika даст реквизиты;
   - состояние оплаты — оно меняется, а выданная бумага нет;
   - сумма прописью.

---

## 9. Отчёты и соседние экраны

- **Неделя.**
  - `pages/WeekPage.tsx`: строка «Поступило — товары» → `/money/payments?from&to&row=goods`.
  - PDF недели (`routes/reports.ts`): `{ka: 'შემოსული — საქონელი', en: 'Received — goods'}`.
  - `lib/week.ts` не меняется: он читает `kind`.
- **Сегодня.** `routes/today.ts weekMoney.goodsTetri = sum(kind === 'goods')`; `TodayPage` складывает его в цифру недели.
- **Платежи.**
  - Фильтр «Основание» получает «Товары» (`t.money.kinds.goods`).
  - `row=goods`; `goodsSaleId` в `paymentWhere`.
  - В include списка и карточки — `goodsSale {id, number}`; `PaymentsList.recordOf` и `PaymentPage.recordLink` ведут на `/sales/goods/:id`.
  - `actWord` += `payment.rebook`: «стал авансом после отмены TS-…».
- **Касса.** `lib/till.ts` не меняется: наличные `goods` считаются по `channel cash` и `created_by`. В `routes/till.ts mine` номер `goodsSale.number`, покупатель «Розничный покупатель»; на `TillPage` вид «Товары».
- **Календарь платежей** не меняется (§1, п. 16).
- **Долг клиента.**
  - `lib/debt.ts:debtsOf` читает `goodsSale` клиентов вместе с живыми платежами `goods` и передаёт их в `customerDebt.goods`.
  - Следствие: долг за товар входит в единую цифру (B7-02), и новая выдача такому клиенту становится решением владельца с причиной (`handOverBlockTetri = owesTetri`), как с ремонтом.
  - `CustomerPage` и `PickupWizard.firstDebt` сейчас всё неизвестное подписывают как аренду; им добавляется `goods`.
- **Экономика.** `lib/economics.ts:goodsLinesOf(from, to)` → `goodsEconomics`; `routes/economics.ts`. На `EconomicsPage` блок «Товары» с периодом (этот месяц / прошлый / всё время):
  - продано, шт.;
  - выручка с НДС → НДС → без НДС;
  - себестоимость, маржа;
  - таблица по позициям;
  - строка «Без себестоимости: N строк на X ₾ без НДС — в маржу не вошли».

  Комиссия эквайринга в маржу товара не входит: это расход компании, он виден в неделе.
- **Карточка клиента.** Строка долга «Товары · TS-…». Блок «Покупки» (`GET /api/goods-sales?customerId=`); пусто — «Покупок нет · Продать товар». В «⋯» — «Продать товар» (`?customer=`).
- **Объединение карточек** (`routes/contacts.ts`, merge): `goodsSales: tx.goodsSale.updateMany(...)` попадает в `moved`. Иначе долг разойдётся по двум карточкам.
- **Склад.**
  - `PartPage`: кнопка «Продать» (`goods.sell`, `?part=`), блок «Продажи» (пусто — «Ещё не продавалась»).
  - Подписи движений по ссылке: issue с продажей — «Продажа TS-…», return с продажей — «Отмена продажи TS-…». Сейчас `return` подписан «Возврат из ремонта».
  - Подпись поля `stock.salePrice` «Цена для клиента» становится «Цена для клиента с НДС» (ka, en тоже).
- **Батареи и зарядки** (`BatteriesPage`): кнопка «Продать зарядку» (`?item=charger`); в ленте «Продана · TS-…», «Вернулась · отмена TS-…», «Нашлась при продаже TS-…».
- **Поиск.** Группа `goods` в `SearchOverlay` (раздел `/sales/goods`); её же берут `WhoPicker` формы денег и `OtherSheet`.
- **Журнал на экране** (`apps/web/src/lib/journal.tsx`): слова для значений `kind: goods`, `stockFrom`, `status` продажи.

---

## 10. Экраны

**Навигация.**
- «Продажи» → вкладки «Мопеды» (`/sales`) | «Товары» (`/sales/goods`).
- «＋» → «Продать товар».
- Маршруты в `App.tsx`: `sales/goods`, `sales/goods/new` (`Require goods.sell`), `sales/goods/:id`. Статичный сегмент `goods` у React Router сильнее `sales/:id`.

**«Продажи → Товары»** (`pages/goods/GoodsSalesPage.tsx`)
- Шапка: «Товары · N», тихая цифра «Ждут оплаты 2 · 145 ₾» (ссылка на сегмент), справа «Продать товар».
- Сегменты: Все · Ждут оплаты · Отменены. Поиск по номеру, покупателю, позиции.
- Телефон — карточки:
  - первая строка — покупатель или «Розничный покупатель», справа открытое или итог;
  - вторая строка — «TS-00001 · Зарядка 73V6A ×1 · 08.10», пилюля «Оплачена» / «Ждёт банк» / «Долг 45 ₾» / «Отменена».
- Ноутбук — таблица.
- Пусто: «Товаров ещё не продавали» + «Продать товар». Загрузка — скелет, ошибка — `LoadError`, нет права — вкладки нет.

**Мастер «Продать товар»** (`pages/goods/GoodsSaleWizard.tsx`, `/sales/goods/new?part=&item=&customer=`). Каркас `Wizard`, черновик на устройстве, ключ операции, «Назад» не теряет введённое.

1. **«Что продаём».**
   - Поиск по названию и артикулу; чип «Зарядка · в шоуруме 4».
   - Строка: название, «на складе N» (красным, если не хватает), степпер «− 1 +» (44 px), цена.
   - Цена склада подставлена. Правка тихо показывает «по складу 130 ₾». Цены нет — поле пустое и обязательное.
   - У зарядки поле «Модель» (73V6A). Владелец видит себестоимость, маржу строки и предупреждение (не запрет), если цена ниже себестоимости.
   - Не хватает:
     - менеджеру — «На складе 0 — продать сверх остатка может владелец»;
     - владельцу — поле «Почему сверх остатка».
   - Задняя дата до пересчёта — вопрос «Пересчёт 15.10 уже не видел этот товар?» («Да — остаток не трогать» выбрано заранее).
2. **«Кому».** «Розничный покупатель» (выбран заранее, если мастер открыт не из карточки клиента) с необязательными именем и телефоном | «Наш клиент» — поиск, на карточке видна его общая цифра долга.
3. **«Оплата и итог».**
   - Чипы: «Наличными» (сумма подставлена и идёт за итогом, пока её не впечатали руками; больше итога — ошибка поля) · «Картой» · «Переводом» · «Позже — в долг» (только свой клиент).
   - Карта или перевод: строки банка ровно этой суммы (`InBankLines`, владельцу) — «Это она» / «Ещё не пришла»; выбранная строка остаётся в списке отмеченной, а остаток считается от её суммы. Иначе подсказка «Владелец привяжет строку банка в „Разобрать“».
   - Розница без оплаты и без банка — ошибка поля «Розничный покупатель платит сразу».
   - Дата: владелец может поставить прошлую, с причиной.
   - Итог: строки; «Итого 100,00 ₾ · в т.ч. НДС 18 % 15,25 ₾»; «Открыто 0» / «Долг клиента после продажи 45 ₾» / «Ждёт банк 100 ₾».
   - Кнопка в липкой полосе «Продать за 100 ₾» → «Записываем…» → открывается карточка (ux №4). Тост: «Продано TS-00001 · Счёт PDF · Отменить».
   - Ошибки сервера ведут на шаг поля (`stepOfField`, `byCode`), как в `SaleWizard`.

**Карточка** (`pages/goods/GoodsSalePage.tsx`)
- Шапка: TS, пилюля, одна цифра — «ждёт 100 ₾» или «100 ₾ оплачено».
- Блоки:
  - «Покупатель»;
  - «Товары» — «по складу 130 → 100», «Списано пересчётом 15.10», «Сверх остатка: причина»; владельцу себестоимость и маржа;
  - «Деньги» — итог, НДС, оплачено, открыто, платежи со строкой банка, «стал авансом» / «аннулирован»;
  - «Строки банка, похожие на эту оплату» — владельцу при открытом > 0, кнопка «Привязать»;
  - «Документы» — «Счёт PDF»;
  - лента.
- Главное действие: открыто > 0 → «Принять деньги» (форма денег, цель `goods`); иначе «Счёт PDF».
- «⋯»: «Отменить продажу», «Изменить покупателя» (владелец).
- Не найдено: «Продажа не найдена · ← Товары».

**Лист отмены.** Причина обязательна, под ней план из `cancel-plan`:
- «Зарядка 73V6A × 1 вернётся в шоурум (3 → 4)»;
- есть строка `stock_from 'count'` — вопрос «Пересчёт уже не видел этот товар. Он вернулся?»: «Нет — остаток не трогать» (выбрано заранее; строка «… — остаток не меняется (3)») · «Да — вернуть на остаток»;
- свой клиент: «100 ₾ станут авансом и погасят неделю 20–26.10 R-…»;
- розница: «Платёж 100 ₾ картой аннулируется; строка TBC 08.10 · 98,50 вернётся в „Разобрать“»; для наличных — «уйдёт из кассы <имя>».

Кнопка названа действием: «Отменить продажу TS-00001». Платёж «погасит / погашено», не «закроет» (issue #9).

**Форма денег** (`ds/money/MoneyForm.tsx`):
- `MoneyKind` += `goods`, `MoneyTarget.goodsSaleId`, `titleFor` «Оплата товаров TS-…»;
- `closeLabel` «Погасит: TS-… 100 ₾ из 100», предел виден до записи;
- `WhoPicker` получает группу `goods`; `TargetHead` — `money-targets.goods`.

---

## 11. Журнал

`entityType 'goods_sale'`. Слова — в `feedWords` (`apps/web/src/i18n/wave4.ts`, ka/ru/en; проверяет `guard:actions`).

| Действие | Вид | Было → стало |
|---|---|---|
| `goods_sale.create` | событие | §6.2 п. 7 |
| `goods_sale.price` | изменение | `{seq, unitPriceTetri: цена склада}` → `{seq, unitPriceTetri}` |
| `goods_sale.minus` | изменение | `{seq, qty: было}` → `{seq, qty: продано}`, причина |
| `goods_sale.update` | изменение | имя, телефон, заметка |
| `goods_sale.invoice` | событие | `{fileId, sha256}` |
| `goods_sale.cancel` / `goods_sale.undo` | изменение | §6.3 п. 6 |
| `payment.goods` | событие денег | как `payment.${kind}` в `writeOther` |
| `payment.rebook` | изменение | `{kind: 'goods', goodsSaleId}` → `{kind: 'on_account'}`, причина |
| `payment.void`, `payment.undo`, `statement.line.assign` / `.rule` / `.split` | есть | в `after` добавляется `goodsSaleId` |

`routes/journal.ts`: `numbersFor` знает `goods_sale` (TS, в том числе для платежей с `goodsSaleId`); `RECORD_KINDS` += `'goods_sale'`; `withParts` добавляет платежи продажи.

---

## 12. Коды ошибок

Тексты — в `errors.codes` en/ru/ka (проверяет `guard:errors`).

| Код | HTTP | Когда |
|---|---|---|
| `goods_no_lines` / `goods_too_many_lines` | 400 | нет строк / больше 20 |
| `goods_line_bad` | 400 | в строке не ровно одно из «позиция склада» / «зарядка» |
| `goods_bad_qty` | 400 | количество не от 1 до 999 |
| `goods_same_item` | 400 | одна позиция дважды |
| `goods_item_not_found` / `goods_item_archived` | 404 / 409 | позиция |
| `goods_item_not_sellable` | 409 | батарея до слова Mika |
| `goods_count_answer` | 400 | дата ≤ пересчёта и нет ответа `{field, lastCountOn}` |
| `goods_short` | 409 | менеджер, не хватает `{lines: [{index, available, asked}]}` |
| `retail_must_pay` | 409 | розница не платит и банка не ждёт |
| `goods_paid_over` | 409 | «Оплачено сейчас» больше итога |
| `goods_sale_not_found` / `goods_sale_closed` | 404 / 409 | продажи нет / она отменена |
| `goods_over_open` | 409 | платёж или целая строка больше открытого `{number, openTetri}` |
| `split_over_goods` | 409 | часть «Товары» больше открытого |
| `goods_payment_in_split` | 409 | отмена розницы, чей платёж — часть разнесённой строки |
| `goods_undo_too_late` | 409 | прошло больше 60 с или отменяет не создатель |

Существующие коды: `missing_field` (`lines[i].unitPriceTetri`, `lines[i].shortReason`, `backdateReason`, `reason`), `owner_only`, `owner_only_backdate`, `future_date`, `reconcile_required`, `customer_not_found`, `customer_archived`, `bank_line_exists`, `already_matched`.

---

## 13. Права

| Что | Право | Роли |
|---|---|---|
| Видеть список и карточку | `fleet.view` | владелец, менеджер |
| Себестоимость, маржа, ввод себестоимости зарядки | `cost.view` | владелец |
| **Продать**, напечатать счёт, «Отменить сразу» (своё, 60 с) | **`goods.sell`** (новое) | владелец, менеджер |
| Продать сверх остатка, с причиной | `stock.count` | владелец |
| Продать задним числом, отменить, править покупателя | `sales.manage` | владелец |
| «Оплачено сейчас» наличными, «Принять деньги» | `cash.record` (`checkMoney`) | менеджер — наличные сегодня; владелец — всё |
| Привязать строку банка, «Разнести», «Разобрать» | `payments.reconcile` | владелец |
| «Экономика → Товары» | `reports.view` | владелец |

Механики не видят ничего из этого: у них нет `fleet.view`.

---

## 14. Тесты и приёмка

**Shared:** `goods.test.ts` (§3.1); правки `week`, `debt`, `due`, `batteries`, `permissions`, `navigation`, `journal`.

**API** (`apps/api/test/goods-sales.test.ts`, `goods-invoice.test.ts`). Своя база `ev8ops_test_goods`. Покупатели, позиции и телефоны только выдуманные: репозиторий публичный.

1. **Зарядка 73V6A × 1 рознице за 100 ₾ картой.**
   - Менеджер продаёт, «Картой — придёт из банка»: шоурум зарядок −1, платежа нет, состояние `waiting_bank`.
   - Строка TBC 08.10 «98.50» с текстом расчёта терминала (сумма 100.00): `gross 10000`, `fee 150`. `decide` → очередь (даже при аренде на 100, выданной в этот день). `suggest` → `goods_sale`.
   - `assign {goodsSaleId}`: платёж `goods`, acquiring, 10000 / 150 / 9850. Продажа `paid`.
   - Неделя: `goodsTetri` 10000, `acquiringFeeTetri` 150, `totalTetri === incomeRows`.
2. **Запчасть за наличные, продаёт менеджер.**
   - `issue −1` со ссылкой на строку; себестоимость = средняя полки.
   - Касса менеджера +35.
   - Строка недели `goods`; `GET /api/payments?row=goods` в сумме равен цифре недели.
3. **Счёт PDF для обеих продаж.** 200, `application/pdf`. В тексте есть «TS-», «84.75», «15.25», «100.00», «საცალო მყიდველი», «412785721». Повторный запрос даёт тот же `sha256`. У клиента-физлица нет личного номера. У отменённой продажи есть «გაუქმებულია».
4. **Отмена своему клиенту.** Продажа оплачена наличными, у клиента открытая неделя:
   - склад +1 (`return` по себестоимости строки);
   - платёж стал `on_account` с прежним `goods_sale_id`;
   - после `settleCredit` неделя погашена;
   - в журнале `goods_sale.cancel` и `payment.rebook`;
   - сумма в неделе переехала из `goods` в `rent`, итог тот же.
5. **Отмена рознице.** Оплата была строкой банка: зарядка `sale_cancelled` +1, платёж аннулирован с причиной, строка снова `unmatched`.
6. **Без перепривязки.**
   - Строка 150 на продажу с открытым 100 → `goods_over_open`.
   - «Разнести» 250 = аренда 150 + товары 100 → два платежа, `rent` и `goods`, комиссия по долям.
   - Часть товаров 120 → `split_over_goods`.
7. **Сверх остатка.**
   - Менеджер → `goods_short`.
   - Владелец без причины → `missing_field shortReason`.
   - Владелец с причиной: запчасть уходит ниже нуля; зарядка — `found` + `sold`, счёт прежний; журнал `goods_sale.minus`.
8. **Пересчёт.**
   - Продажа 08.10 при пересчёте 15.10 без ответа → `goods_count_answer`.
   - `countedAlready: true` → движения нет, `stock_from 'count'`.
   - Отмена такой продажи → +1.
9. **Розница и деньги.**
   - Без оплаты и без банка → `retail_must_pay`.
   - Переплата → `goods_paid_over`.
   - Менеджер со строкой банка → `reconcile_required`.
   - Владелец со строкой → продажа и привязка одной транзакцией.
10. **Долг своего клиента.**
    - «Позже»: часть `goods` в `debtOf`; менеджеру выдача отказывает `customer_in_debt`.
    - Строка с его именем на ровно этот долг → правило `payer_name` к TS.
    - Если у клиента ещё аренда той же суммы → очередь.
11. **Цена.** Склад 130, продано за 100 → `goods_sale.price`; в карточке `priceEdited`.
12. **Разнесённая строка.** Розничный платёж — часть разнесённой строки → `goods_payment_in_split`.
13. **«Отменить сразу».** Создатель за 60 с → всё вернулось, платёж `undo`. Через 61 с или не создатель → `goods_undo_too_late`.
14. **Права.**
    - Механик → 403 на `POST /api/goods-sales`.
    - Менеджер → 403 на cancel и PATCH.
    - Менеджер с прошлой датой → `owner_only_backdate`.
    - Менеджер не видит `unitCostTetri`.
15. **Ключ операции.** Один ключ дважды → одна продажа, один платёж, одно движение.
16. **Гонка.** Две параллельные продажи последней зарядки менеджерами → одна проходит, вторая получает `goods_short`.
17. **Объединение карточек.** Переносит `goods_sales`.
18. **Экономика.** 100 + 35 → выручка, НДС, без НДС, себестоимость, маржа; зарядка без себестоимости в `unknownCost`.
19. **Обратная совместимость.** После рефактора `recordMoneyTx` зелёные `money`, `statements`, `reconcile`, `week`, `stock`, `batteries`; `guard.test.ts` — scope у каждого нового маршрута.

**Проверки:** `npm run guard` (`i18n`, `errors`, `actions`, `words` — «Погасит / Погашено»; ложные срабатывания `=> string {` в `.tsx` переписать), `typecheck`.

**Глазами** (тестовый стенд, 375 px, KA и RU, владелец и менеджер):
- шесть состояний у списка, мастера и карточки;
- одна залитая кнопка на экране;
- грузинские подписи переносятся, а не обрезаются;
- контраст ≥ 4,5:1.

---

## 15. Документы

- `docs/adr/0045-goods-are-sold-from-the-shelf-with-vat-inside.md` (Найгард). Контекст — issue #11. Решение — §0–§1. Исключение «НДС внутри» и почему. Последствия:
  - долг за товар входит в цифру долга;
  - после отмены сумма прошлой недели переезжает из «Товары» в «Аренда»;
  - счёт ≠ RS.ge.
- `docs/design/ux.md`: вкладки «Продажи → Мопеды | Товары», мастер «Продать товар».
- `docs/handoff.md`: запись об изменении.
- `docs/qa/goods-sales-ka-strings.md`: грузинские строки на проверку Kardu (ინვოისი, საქონელი, საცალო მყიდველი, подписи итогов счёта).
- `CLAUDE.md` уже содержит исключение и расширение (`124fb23`). По желанию к строке «Domain facts» добавить «ADR-0045».
- Книга проекта (правит сессия Mika): `business/money.md` (исключение НДС, счёт покупателю ≠ фактура RS.ge), глоссарий («Товары», «Розничный покупатель»).

---

## 16. Порядок работы

Worktree `feature/goods-sales`. Каждую законченную правку — коммит и push.

1. Shared: `goods.ts` и правки `week`, `debt`, `batteries`, `permissions`, `navigation`, `journal` с тестами.
2. Миграция 0067, Prisma; `lib/stock.ts` (`shelfCost`, `partOnHandTx`, `lastCountOn`, движения); `batteriesNow(db)`.
3. Деньги: `lib/money.ts` (`goods`, `recordMoneyTx`); `lib/payments.ts` (`rebookToCredit`); statements (`import`, `reconcile`, `inBank`, маршруты); `routes/payments.ts`.
4. `lib/goods.ts`, `routes/goodsSales.ts`, счёт PDF, экономика, поиск, журнал, объединение карточек, клиент, склад, батареи, «Сегодня», неделя + тесты API.
5. Web: вкладки, список, мастер, карточка, лист отмены, форма денег, «Разобрать», платежи, касса, неделя, «Сегодня», экономика, клиент, склад, батареи, поиск, i18n. Если Mika захочет увидеть экраны до сборки — статичный прототип без JS.
6. ADR, документы, гейт на своей базе, слияние в `develop`, тестовый стенд, QA. На боевой — по слову Mika, его командой `deploy/release.sh`.

Строкой Mika при выкладке: реальную продажу 08.10 вводят люди, данными, а не кодом. Если пересчёта зарядок на боевом ещё нет, владелец продаёт её «сверх счёта» с причиной.

---

## 17. Не входит и вопросы

- **IBAN для счёта** — единственный открытый вопрос к Mika (данные).
- **Возврат денег покупателю** (наличными или обратной операцией по карте) не моделируется. Если понадобится — отдельный вид расхода, решать Mika.
- **Позже:**
  - продажа батарей;
  - категория «Аксессуары»;
  - цены и себестоимость зарядок по моделям;
  - «сделать розничного покупателя клиентом»;
  - пункт «Сегодня» для розницы, которая ждёт банк дольше N дней;
  - автоправило «карта в день продажи» для розницы.

---

## 18. Чек-лист точек касания

**База и модель**
- [x] `apps/api/migrations/0067_goods_sales.sql`
- [x] `apps/api/prisma/schema.prisma` — `PaymentKind.goods`, `GoodsSale`, `GoodsSaleLine`, связи у `Payment`, `StockMove`, `BatteryMove`, `StoredFile`, `Customer`, `Part`, `User`

**Shared**
- [x] `packages/shared/src/goods.ts` (новый) + `index.ts`
- [x] `packages/shared/src/week.ts` — строка `goods`, `Record` вместо тернарников, `PAYMENT_FILTERS`
- [x] `packages/shared/src/debt.ts` — `goods`, `DebtPart.kind`
- [x] `packages/shared/src/batteries.ts` — `sold`, `sale_cancelled`
- [x] `packages/shared/src/permissions.ts` — `goods.sell`
- [x] `packages/shared/src/navigation.ts` — вкладка `goods`, действие `sellGoods`
- [x] `packages/shared/src/journal.ts` — `goods_sale.*`, `TS`
- [x] `packages/shared/test/*` — goods, week, debt, due, batteries, permissions, navigation, journal

**API: библиотеки**
- [x] `apps/api/src/lib/goods.ts` (новый) — `goodsOwed`, `createGoodsSaleTx`, `cancelGoodsSaleTx(mode)`
- [x] `apps/api/src/lib/money.ts` — `MONEY_KINDS`, `MoneyInput`, `Closes`, `planMoney`, `FROM_CUSTOMER`, `payerOf`, `writeOther`, `recordMoneyTx`
- [x] `apps/api/src/lib/payments.ts` — `rebookToCredit`
- [x] `apps/api/src/lib/stock.ts` — `shelfCost`, `partOnHandTx`, `lastCountOn`, `issueForGoodsLine`, `returnGoodsLine`
- [x] `apps/api/src/routes/service.ts` — `shelfPrice` → `shelfCost`
- [x] `apps/api/src/lib/statements/reconcile.ts` — `Ctx.goods`, `loadCtx`, `decide`, `RuleTarget`, `suggest`, `Suggestion`, `Reason`
- [x] `apps/api/src/lib/statements/import.ts` — `LineTarget`, `paymentOf`, `attach`, `split`, `ingest`
- [x] `apps/api/src/lib/statements/inBank.ts` — номер TS
- [x] `apps/api/src/lib/debt.ts` — продажи товаров клиентов
- [x] `apps/api/src/lib/economics.ts` — `goodsLinesOf`
- [x] `apps/api/src/lib/pdf/goodsInvoice.ts` (новый), `apps/api/src/lib/pdf/company.ts` — `gel2`

**API: маршруты**
- [x] `apps/api/src/routes/goodsSales.ts` (новый) + `apps/api/src/server.ts`
- [x] `apps/api/src/routes/documents.ts` — `invoice.pdf`
- [x] `apps/api/src/routes/payments.ts` — `moneyInput`, `paymentWhere`, include `goodsSale`, `money-targets.goods`
- [x] `apps/api/src/routes/statements.ts` — `assign`, `split`, `by-rules`
- [x] `apps/api/src/routes/batteries.ts` — `batteriesNow(db)`, `sold` / `sale_cancelled`, номер продажи в ленте
- [x] `apps/api/src/routes/stock.ts` — `GET /api/parts/:id`: продажи
- [x] `apps/api/src/routes/customers.ts` — покупки, номер в ленте
- [x] `apps/api/src/routes/contacts.ts` — merge `goodsSales`
- [x] `apps/api/src/routes/search.ts` — группа `goods`
- [x] `apps/api/src/routes/till.ts` — номер TS
- [x] `apps/api/src/routes/today.ts` — `weekMoney.goodsTetri`
- [x] `apps/api/src/routes/reports.ts` — строка PDF недели
- [x] `apps/api/src/routes/economics.ts` — `GET /api/economics/goods`
- [x] `apps/api/src/routes/journal.ts` — `numbersFor`, `RECORD_KINDS`, `withParts`
- [x] `apps/api/test/goods-sales.test.ts`, `goods-invoice.test.ts` (новые), `guard.test.ts`, хелпер строк в `week.test.ts`

**Web**
- [x] `apps/web/src/App.tsx` — три маршрута
- [x] `apps/web/src/pages/goods/GoodsSalesPage.tsx`, `GoodsSaleWizard.tsx`, `GoodsSalePage.tsx` (новые)
- [x] `apps/web/src/ds/money/MoneyForm.tsx` — `goods`
- [x] `apps/web/src/pages/money/SortPage.tsx` — `LineCard`, `useReasonText`, `OtherSheet`, `SplitSheet` (часть «Товары», розничный режим)
- [x] `apps/web/src/pages/money/PaymentsList.tsx` — `Kind`, `recordOf`
- [x] `apps/web/src/pages/money/PaymentPage.tsx` — `Kind`, `recordLink`, `actWord`
- [x] `apps/web/src/pages/money/TillPage.tsx`
- [x] `apps/web/src/pages/WeekPage.tsx`, `TodayPage.tsx`, `EconomicsPage.tsx`
- [x] `apps/web/src/pages/CustomerPage.tsx` — подпись долга, «Покупки», «Продать товар»
- [x] `apps/web/src/pages/PickupWizard.tsx` — `firstDebt`
- [x] `apps/web/src/pages/PartPage.tsx` — «Продать», «Продажи», подписи движений
- [x] `apps/web/src/pages/BatteriesPage.tsx` — «Продать зарядку», лента
- [x] `apps/web/src/ds/search/SearchOverlay.tsx` — группа `goods`
- [x] `apps/web/src/lib/journal.tsx` — слова значений
- [x] `apps/web/src/i18n/goods.ts` (новый) + `en.ts` / `ru.ts` / `ka.ts` (`money.kinds.goods`, `shell.tabs.goods`, `actions.sellGoods`, `weekReport.inGoods`, `stock.salePrice`, `errors.codes.*`) + `wave4.ts` (`feedWords`)

**Документы**
- [x] `docs/adr/0045-goods-are-sold-from-the-shelf-with-vat-inside.md`
- [x] `docs/design/ux.md`, `docs/handoff.md`, `docs/qa/goods-sales-ka-strings.md`
- [ ] (книга, сессия Mika) `business/money.md`, глоссарий

---

## Приложение. Как сведены два черновика

| Вопрос | Взято | Отброшено и почему |
|---|---|---|
| Цель распределения | Без неё, как у ремонта | `AllocationTarget 'goods'` + вторая миграция: у продажи нет графика, лишние правки `allocation_shape`, `writeAllocations`, `settledLabel` |
| Миграций | Одна, 0067 (0066 — прецедент без CHECK на новое значение) | 0068 + 0069 |
| Зарядка сверх счёта | `found` → `sold` у владельца с причиной | «Нельзя никому» сужало умолчание Mika |
| Продажа до пересчёта | Вопрос и `stock_from 'count'` | Одно предупреждение оставляло двойное списание |
| Карта в мастере | «Ждёт банк» или привязка пришедшей строки | Ручной платёж картой: дневные строки TBC его не найдут |
| Цена и себестоимость зарядки | Ручная цена, себестоимость в строке у владельца | Таблица `counted_item_prices` с маршрутами — лишнее для v1 |
| Правила «Разобрать» | Имя + товары; блок правил аренды при товаре той же суммы | — |
| «Разнести» | Часть «Товары» у клиента + розничный режим | Без розничного режима дневную строку карт не разнести |
| Отмена своему клиенту | Перевод в `on_account` + `settleCredit` после коммита | Раскладка внутри транзакции дублировала бы `recordPaymentTx` |
| Платёж по готовой продаже | Существующий `POST /api/money` | Отдельный `/:id/payments` — вторая дверь для денег |
| Мастер | Три шага | Четыре шага |
| Код перебора | Новый `goods_over_open` | `over_open` — текст про ремонт |
| Вкладка «Мопеды» | Существующий `TabId 'vehicles'` | Новый `'mopeds'` |
| «Отменить сразу» | Есть, 60 с, как у платежей | — |
| `CLAUDE.md` | Уже правлен (`124fb23`) | Повторная правка |
