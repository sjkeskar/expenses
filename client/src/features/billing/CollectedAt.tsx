import { DatePicker, Flex, Typography } from "antd";
import { DATE_TIME, istNow, type Dayjs } from "../../lib/format";

// When the samples were really taken, inside the "Mark collected"
// confirmation of a bill and of the revisit list. Left empty it means now,
// by the server's clock; a collection entered afterwards (a home visit)
// gets its real time here. Never a future day; the server refuses a future time.
export default function CollectedAt({ who, value, onChange }: { who?: string; value: Dayjs | null; onChange(value: Dayjs | null): void }) {
  return (
    <Flex vertical gap={8} style={{ maxWidth: 280 }}>
      <Typography.Text>{who ? `From ${who}, recorded by you.` : "Recorded as collected by you."} Leave the time empty if they were taken just now.</Typography.Text>
      <DatePicker
        aria-label="Collected at"
        placeholder="Now"
        {...DATE_TIME}
        value={value}
        onChange={onChange}
        disabledDate={(d) => d.isAfter(istNow(), "day")}
        style={{ width: "100%" }}
      />
    </Flex>
  );
}
