import { fireEvent, render, screen, within } from "@testing-library/preact";
import { Table, type Column } from "./components/Table";
import { formatBytes } from "./format";

interface Row {
  broker: string;
  disk: number;
}
const rows: Row[] = [
  { broker: "kafka-1", disk: 5 * 1024 ** 3 },
  { broker: "kafka-0", disk: 1024 ** 3 },
  { broker: "kafka-2", disk: 3 * 1024 ** 3 },
];
const columns: Column<Row>[] = [
  { key: "broker", header: "Broker", value: (r) => r.broker },
  { key: "disk", header: "Disk", value: (r) => r.disk, render: (r) => formatBytes(r.disk), numeric: true },
];
const order = () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row").map((r) => r.textContent);

describe("Table", () => {
  it("sorts by a column and a second click reverses it", () => {
    render(<Table caption="Brokers" columns={columns} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /Disk/ }));
    expect(order()).toEqual(["kafka-01 GiB", "kafka-23 GiB", "kafka-15 GiB"]);
    expect(screen.getByRole("columnheader", { name: /Disk/ }).getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: /Disk/ }));
    expect(order()).toEqual(["kafka-15 GiB", "kafka-23 GiB", "kafka-01 GiB"]);
    expect(screen.getByRole("columnheader", { name: /Disk/ }).getAttribute("aria-sort")).toBe("descending");
  });

  it("filters by column", () => {
    render(<Table caption="Brokers" columns={columns} rows={rows} />);
    fireEvent.input(screen.getByLabelText("Filter Broker"), { target: { value: "kafka-2" } });
    expect(order()).toEqual(["kafka-23 GiB"]);
    fireEvent.input(screen.getByLabelText("Filter Broker"), { target: { value: "zzz" } });
    expect(order()).toEqual(["No rows"]);
  });

  it("shows bytes with units", () => {
    render(<Table caption="Brokers" columns={columns} rows={[rows[1]]} />);
    expect(screen.getByText("1 GiB")).toBeTruthy();
  });
});
