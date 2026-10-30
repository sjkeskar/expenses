import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, DatePicker, Empty, Flex, Select, Table, Typography } from "antd";
import { useSession } from "../../auth/session";
import { useApi } from "../../lib/hooks";
import { ageSex, BILL_STATUS, dayOf, dayPicker, formatMoney, formatTime, istNow, istToday, MODE_LABELS, MODES, ROLE_LABELS } from "../../lib/format";
import Page, { Figures, NOWRAP, Section } from "../../components/Page";
import type { DaySheet, PaymentMode, Role } from "../../types/api";
import { HoldBadge, payerText } from "../billing/BillsPage";

const OVERSIGHT: Role[] = ["lead_pathologist", "accountant"];
const KIND_TEXT = { payment: "Payment", settlement: "Panel settlement", refund: "Refund" };

// The Day Sheet (pivot.md §6.7): what one person did on a day — the money
// they took (on any bill, refunds subtracted: the cash hand-over figure)
// and the bills they created. The lead and the accountant can open anyone's.
export default function DaySheetPage() {
  const { user } = useSession();
  const oversight = OVERSIGHT.includes(user!.role);
  const [date, setDate] = useState(istToday());
  const [userId, setUserId] = useState<string | undefined>(user!.role === "accountant" ? undefined : user!.id);
  const people = useApi<{ users: { id: string; name: string; role: Role; isDeleted: boolean }[] }>(oversight ? "/daysheet/users" : null);
  const query = `date=${date}&userId=${userId}`;
  const sheet = useApi<DaySheet>(userId ? `/daysheet?${query}` : null);
  const data = sheet.data?.date === date && sheet.data.user.id === userId ? sheet.data : undefined;

  return (
    <Page
      title="Day sheet"
      description={oversight ? "What one person took and billed on a day." : "What you took and billed on a day."}
      actions={<Button disabled={!data} onClick={() => window.open(`/print/day-sheet?${query}`, "_blank")}>Print</Button>}
    >
      <Section
        toolbar={
          <>
            <DatePicker
              aria-label="Date"
              format="DD/MM/YYYY"
              allowClear={false}
              value={dayPicker(date)}
              onChange={(d) => d && setDate(dayOf(d))}
              disabledDate={(d) => d.isAfter(istNow(), "day")}
            />
            {oversight && (
              <Select
                aria-label="Whose day sheet"
                placeholder="Choose a person"
                showSearch={{ optionFilterProp: "label" }}
                value={userId}
                onChange={setUserId}
                style={{ minWidth: 240 }}
                options={people.data?.users.map((u) => ({ value: u.id, label: `${u.name} (${ROLE_LABELS[u.role]}${u.isDeleted ? ", deactivated" : ""})` }))}
              />
            )}
          </>
        }
      >
        {!userId ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Choose whose day sheet to open." />
        ) : (
          <Figures
            items={[
              ...MODES.map((mode) => ({ label: MODE_LABELS[mode], value: data ? formatMoney(data.totals[mode]) : "—" })),
              { label: "Total to hand over", value: data ? formatMoney(data.totals.total) : "—", strong: true },
              { label: "Bills created", value: data ? data.bills.length : "—" },
            ]}
          />
        )}
      </Section>
      {data && (
        <>
          <Section title="Money taken" flush>
            <Table
              rowKey={(m) => `${m.kind}${m.at}${m.bill.id}`}
              size="middle"
              pagination={false}
              dataSource={data.money}
              locale={{ emptyText: "No money taken" }}
              columns={[
                { title: "Time", dataIndex: "at", render: formatTime, ...NOWRAP },
                { title: "Bill no.", ...NOWRAP, render: (_, m) => <Link to={`/bills/${m.bill.id}`}>{m.bill.billNumber}</Link> },
                { title: "Patient", render: (_, m) => m.bill.patient.name },
                { title: "Kind", dataIndex: "kind", render: (k: keyof typeof KIND_TEXT) => KIND_TEXT[k] },
                { title: "Mode", dataIndex: "mode", render: (m: PaymentMode) => MODE_LABELS[m], ...NOWRAP },
                { title: "Amount", dataIndex: "amount", align: "right", render: formatMoney, ...NOWRAP },
              ]}
              summary={() => (
                <>
                  {MODES.map((mode) => (
                    <Table.Summary.Row key={mode}>
                      <Table.Summary.Cell index={0} colSpan={5}>
                        {MODE_LABELS[mode]}
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right">
                        {formatMoney(data.totals[mode])}
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  ))}
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={5}>
                      <Typography.Text strong>Total to hand over</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Typography.Text strong>{formatMoney(data.totals.total)}</Typography.Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </>
              )}
            />
          </Section>
          <Section title="Bills created" flush>
            <Table
              rowKey="id"
              size="middle"
              pagination={false}
              dataSource={data.bills}
              locale={{ emptyText: "No bills created" }}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "Time", dataIndex: "createdAt", render: formatTime, ...NOWRAP },
                { title: "Bill no.", ...NOWRAP, render: (_, b) => <Link to={`/bills/${b.id}`}>{b.billNumber}</Link> },
                { title: "Patient", render: (_, b) => b.patient.name },
                { title: "Age / sex", render: (_, b) => ageSex(b.patientAge, b.patient.sex), ...NOWRAP },
                { title: "Items", render: (_, b) => b.items.map((i) => i.code).join(", ") },
                { title: "Referral", render: (_, b) => (b.referralType === "walk_in" ? "Walk-in" : (b.referringDoctor?.name ?? "Doctor")) },
                { title: "Payer", render: (_, b) => payerText(b) },
                { title: "Net", dataIndex: "netAmount", align: "right", render: formatMoney, ...NOWRAP },
                { title: "Paid", align: "right", render: (_, b) => formatMoney(Number(b.netAmount) - Number(b.balance)), ...NOWRAP },
                { title: "Balance", dataIndex: "balance", align: "right", render: formatMoney, ...NOWRAP },
                {
                  title: "Status",
                  ...NOWRAP,
                  render: (_, b) => (
                    <Flex vertical>
                      <Badge {...BILL_STATUS[b.status]} />
                      <HoldBadge holds={b.holds} />
                    </Flex>
                  ),
                },
              ]}
            />
          </Section>
        </>
      )}
    </Page>
  );
}
