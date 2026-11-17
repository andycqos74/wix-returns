# Returns admin (private Wix app)

Lets staff log returns and exchanges against an order from the Wix dashboard. The
Returns Desk app only lets customers start returns; this app is for staff and runs alongside it.

**What it does**

| Where | What |
|---|---|
| **Order page** (Sales → Orders → an order) | A *Returns & exchanges* card in the right column lists this order's returns. **Process return** opens the form. |
| **Process return** form | Pick the lines and quantities coming back (it won't let you return more than was ordered, counting earlier returns), choose a reason, then pick **Return** or **Exchange**. For an exchange, search the catalogue for the replacement product and size/colour, then set any **price difference** and **postage** charge. |
| **Exchange** | Creates a **new Wix order** for the replacement items, linked to the return. The replacement products are priced at £0, and any charges go on as fees. If money is owed, it creates a **payment link** for you to send the customer, and shows whether it has been paid. The replacement order then goes through your normal fulfilment. |
| **Mark received** | When the parcel arrives, set how many of each line go **back to stock** (0 for damaged items). Stock is added in Wix Stores (works with both catalogue versions). |
| **Refunds** | Recorded only: the amount owed and whether it's been done. You still issue the refund from the order's own **Refund** button, then click **Mark refund done**. |
| **Returns & exchanges page** (dashboard sidebar, under Apps) | Every return, filterable by status and type, with a *Still to do* column (item back, restock, replacement order, customer payment, refund). |

Each return keeps a dated history of every action.

Statuses: **Awaiting item → Received → Completed**, or **Cancelled** while still awaiting the item.

> ⚠️ **Don't restock twice.** This app restocks when you click *Mark received*. When you
> then refund in Wix, **untick Wix's "restock items" option** in the refund dialog.

---

## Project layout

```
src/
  lib/returns-logic.ts    all the rules (no Wix imports, unit-tested)
  lib/wix-ops.ts          every Wix API call (orders, draft orders, payment links, stock, CMS)
  lib/config.ts           collection ID and modal ID
  components/             form and detail views shared by the modal and the page
  extensions/
    backend/data-collections/                        the Returns collection
    dashboard/plugins/returns-exchanges/             order page card
    dashboard/modals/return-editor/                  form / detail modal
    dashboard/pages/returns/                         list page
test/returns-logic.test.mjs
```

Commands: `npm test`, `npm run typecheck`, `npm run dev` (= `wix app dev`), `npm run build`, `npm run release`.

## Getting it running

1. **Permissions.** Open the app in the [app dashboard](https://manage.wix.com/apps/9a720d8c-fc6a-4a64-85c4-6c64f8f26da9/home), go to
   **Develop → Permissions → Add Permissions**, and add:
   - **Manage eCommerce – all permissions** (`SCOPE.DC-ECOM-MEGA.MANAGE-ECOM`)
   - **Draft orders** (`SCOPE.ECOM.DRAFT-ORDERS`)
   - **Manage Stores – all permissions**
   - read/write data items
   If something is missing, the error toast or browser console names the permission it needs.
2. **Payment Request page.** In the site editor, add the **Payment Request** page and publish. Without it,
   *Create payment link* fails with `ORDER_PAYMENT_REQUEST_PAGE_NOT_FOUND`.
3. **Test on a development site.** Run `npm run dev`, pick or create a dev site and install the app on it. Then:
   - log a **return**, *Mark received* with 1 back to stock, and check that inventory goes up by 1
   - log an **exchange** with no charge, and check the replacement order appears at £0 and that its stock is taken
   - log an **exchange with postage**, and open the payment link in a private window to check the amount
4. **Go live.** Run `npm run release`, then install the app on the live site from the app dashboard
   (private apps get a direct install link).

## Things to know

- **Replacement orders** come from Wix's Draft Orders API. Replacement products are priced at £0,
  and the price difference and postage are added as order fees, so the replacement order's total is
  exactly what the customer owes. The customer gets Wix's normal order confirmation email for it.
- If creating the replacement order fails (e.g. a product went out of stock), the return is still
  saved. Open it and use **Create replacement order** once it's fixed.
- **Paid?** The return checks the payment link's status each time you open it. Use **Check if paid** to check again
  or **Paid another way** if they paid by bank transfer, etc.
- Amounts display in **GBP**.
- Return numbers are `<order number>-R1`, `-R2`, …
- The data lives in the **Returns & Exchanges** CMS collection, which only site admins can read or write. You can
  export it from the CMS.
- Run the logic tests here with `npm test`.

## Not verified yet

The code typechecks against Wix's current SDK and design-system types, and the logic is unit-tested.
It also builds with `wix app build`. It hasn't been run against a real Wix site, so step 3 above is that check. These points depend on Wix behaviour:

1. Whether a **£0 replacement order** is automatically marked *Paid* (Wix normally does this for £0
   orders). If not, mark it paid on the order.
2. Whether the replacement order **deducts stock** like a normal order (it should).
3. The permission names in step 1, which Wix sometimes renames.
