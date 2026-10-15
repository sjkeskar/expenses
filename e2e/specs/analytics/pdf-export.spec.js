// G7 + I8: every "Download PDF" button produces a real PDF with the right
// filename, title, subtitle and the rows currently on screen.
const { test, expect } = require("../../fixtures");
const { BillingPage } = require("../../pages/billing");
const { AdminPage } = require("../../pages/admin");
const { AnalyticsSection } = require("../../pages/analytics");
const { createUser } = require("../../helpers/db");
const { readPdfDownload } = require("../../helpers/pdf");
const { uid, inr, istDate, displayDate } = require("../../helpers/data");

for (const role of ["operator", "admin"]) {
  test(`G7: My Bills PDF as ${role} contains my bills and the totals row`, async ({ api, loginAs }, testInfo) => {
    const user = await createUser(role);
    const mine = await api(user);
    const a = await mine.createBill({ originalAmount: 1234.5, initialAmountCollected: 34.5 });
    const b = await mine.createBill({ originalAmount: 100, initialAmountCollected: 100 });
    const c = await mine.createBill({ originalAmount: 50, initialAmountCollected: 10 });
    await mine.refund(c.id);

    const ui = new BillingPage(await loginAs(user));
    const [download] = await Promise.all([ui.page.waitForEvent("download"), ui.myBillsPdf.click()]);
    const pdf = await readPdfDownload(download, testInfo.outputPath());

    expect(pdf.name).toBe(`my-bills_${istDate()}.pdf`);
    expect(pdf.runs[0]).toBe("My Bills");
    expect(pdf.flat).toContain("bills you personally created");
    for (const bill of [a, b, c]) expect(pdf.runs).toContain(bill.billNumber);
    expect(pdf.runs).toContain(a.client.name);
    expect(pdf.runs).toContain(inr(1234.5));
    expect(pdf.runs).toContain("Refunded");
    expect(pdf.flat).toContain("Total (2 bills, 1 refunded excluded)");
  });
}

for (const { role, year } of [{ role: "admin", year: 2014 }, { role: "accountant", year: 2013 }]) {
  test.describe(`Analytics PDFs as ${role}`, () => {
    // Each test gets its own day so parallel tests never share day-wise rows.
    let nextDay = 1;
    const pdfTest = (title, body) => {
      const dd = String(nextDay++).padStart(2, "0");
      test(title, async ({ api, loginAs, adminApi }, testInfo) => {
        // Shift the year per --repeat-each run so repeats don't share a day either.
        const day = `${year - 20 * testInfo.repeatEachIndex}-05-${dd}`;
        const ctx = await arrange({ api, loginAs, adminApi, role, day });
        await body(ctx, testInfo);
      });
    };

    const CASES = [
      ["dayWise", "day-wise-summary", "Day-wise Summary", (c) => [displayDate(c.day), inr(250), `1 (${inr(250)})`]],
      ["operatorWise", "operator-wise-summary", "Operator-wise Summary", (c) => [c.op.name, inr(900), inr(650)]],
      ["locationWise", "location-wise-summary", "Location-wise Summary", (c) => [c.bill.locationName, inr(900)]],
      ["categoryWise", "category-wise-summary", "Category-wise Summary", (c) => [c.bill.categoryName, "standard"]],
    ];
    for (const [button, file, title, tokens] of CASES) {
      pdfTest(`I8: ${title} PDF`, async (c, testInfo) => {
        const pdf = await readPdfDownload(await c.a.download(button), testInfo.outputPath());
        expect(pdf.name).toBe(`${file}_${istDate()}.pdf`);
        expect(pdf.runs[0]).toBe(title);
        expect(pdf.runs[1]).toBe(`Showing: ${c.day} only`);
        for (const t of tokens(c)) expect(pdf.runs, t).toContain(t);
      });
    }

    pdfTest("I8: Client Outstanding PDF is a current snapshot", async (c, testInfo) => {
      const pdf = await readPdfDownload(await c.a.download("clientOutstanding"), testInfo.outputPath());
      expect(pdf.name).toBe(`client-outstanding_${istDate()}.pdf`);
      expect(pdf.runs[0]).toBe("Client Outstanding Balances");
      expect(pdf.runs[1]).toMatch(/^As of /);
      expect(pdf.runs).toContain(c.client);
      expect(pdf.runs).toContain(inr(650));
    });

    pdfTest("I8: Client Detail PDF needs a selected client, then has both sections", async (c, testInfo) => {
      let alertText = "";
      c.a.page.once("dialog", (d) => {
        alertText = d.message();
        d.accept();
      });
      await c.a.pdfButtons.clientDetail.click();
      await expect.poll(() => alertText).toBe("Select a client in Per-Client Detail first.");

      await c.a.selectLedgerClient(c.client);
      const pdf = await readPdfDownload(await c.a.download("clientDetail"), testInfo.outputPath());
      expect(pdf.name).toBe(`client-detail_${c.client.toLowerCase()}_${istDate()}.pdf`);
      expect(pdf.flat).toContain("Client Detail");
      expect(pdf.flat).toContain(c.client);
      expect(pdf.runs).toContain("Per-day summary");
      expect(pdf.runs).toContain("Bill ledger");
      expect(pdf.runs).toContain(c.bill.billNumber);
      expect(pdf.flat).toContain(`(upi, ${c.op.name})`);
    });

    pdfTest("I8: Download All includes every section (and per-client only when selected)", async (c, testInfo) => {
      const without = await readPdfDownload(await c.a.download("all"), testInfo.outputPath("a"));
      expect(without.name).toBe(`full-analytics-report_${istDate()}.pdf`);
      expect(without.runs[0]).toBe("Full Analytics Report");
      for (const heading of ["Day-wise Summary", "Operator-wise Summary", "Location-wise Summary", "Category-wise Summary"]) {
        expect(without.runs).toContain(heading);
      }
      expect(without.flat).toContain("Client Outstanding Balances");
      expect(without.flat).not.toContain("Per-Client Detail");

      await c.a.selectLedgerClient(c.client);
      const withClient = await readPdfDownload(await c.a.download("all"), testInfo.outputPath("b"));
      expect(withClient.flat).toContain("Per-Client Detail");
      expect(withClient.runs).toContain(c.bill.billNumber);
    });
  });
}

// One operator, one bill (900 billed, 250 collected by UPI) at a fresh
// location/category on `day`; then opens analytics for `role` on that day.
async function arrange({ api, loginAs, adminApi, role, day }) {
  const op = await createUser("operator");
  const loc = await adminApi.addLocation({ locationCode: "60" });
  const cat = await adminApi.addCategory();
  const client = uid("PdfClient");
  const bill = await (await api(op)).createBill({
    clientName: client, billDate: day, locationId: loc.id, categoryId: cat.id,
    originalAmount: 900, initialAmountCollected: 250, initialMode: "upi",
  });
  bill.locationName = loc.name;
  bill.categoryName = cat.name;

  const page = await loginAs(await createUser(role));
  let a;
  if (role === "admin") {
    const admin = new AdminPage(page);
    await admin.openTab("analytics");
    a = admin.analytics;
  } else {
    a = new AnalyticsSection(page);
  }
  await a.setRange(day);
  return { a, op, bill, client, day };
}
