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

  it("hides the filter row behind a Filter button until it is pressed", () => {
    render(<Table caption="Brokers" columns={columns} rows={rows} />);
    expect(screen.queryByLabelText("Filter Broker")).toBeNull();
    const btn = screen.getByRole("button", { name: "Filter" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Filter Broker")).toBeTruthy();
  });

  it("filters by column", () => {
    render(<Table caption="Brokers" columns={columns} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.input(screen.getByLabelText("Filter Broker"), { target: { value: "kafka-2" } });
    expect(order()).toEqual(["kafka-23 GiB"]);
    fireEvent.input(screen.getByLabelText("Filter Broker"), { target: { value: "zzz" } });
    expect(order()).toEqual(["No rows"]);
  });

  it("keeps the filter row open while a filter has text", () => {
    render(<Table caption="Brokers" columns={columns} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.input(screen.getByLabelText("Filter Broker"), { target: { value: "kafka-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByLabelText("Filter Broker")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("has no Filter button when the table is not filterable", () => {
    render(<Table caption="Brokers" columns={columns} rows={rows} filterable={false} />);
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
  });

  it("shows the caption as a visible title and keeps the accessible name", () => {
    render(<Table caption="Brokers" columns={columns} rows={rows} />);
    const title = screen.getByText("Brokers");
    expect(title.closest("caption")).toBeTruthy();
    expect(title.className).not.toContain("sr-only");
    expect(screen.getByRole("table", { name: "Brokers" })).toBeTruthy();
  });

  describe("pageable", () => {
    const many: Row[] = Array.from({ length: 25 }, (_, i) => ({ broker: `b-${String(i + 1).padStart(2, "0")}`, disk: i }));
    const brokers = () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row").map((r) => r.firstElementChild!.textContent);

    it("shows 10 rows, pages with Next, and announces the page", () => {
      render(<Table caption="Brokers" columns={columns} rows={many} pageable />);
      expect(brokers()).toHaveLength(10);
      const status = screen.getByText("Page 1 of 3");
      expect(status.getAttribute("aria-live")).toBe("polite");
      expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(brokers()).toEqual(many.slice(10, 20).map((r) => r.broker));
      expect(screen.getByText("Page 2 of 3")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("shows every row and no pager with All", () => {
      render(<Table caption="Brokers" columns={columns} rows={many} pageable />);
      fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "all" } });
      expect(brokers()).toHaveLength(25);
      expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
      expect(screen.queryByText(/^Page /)).toBeNull();
    });

    it("has no pager when one page holds every row", () => {
      render(<Table caption="Brokers" columns={columns} rows={many} pageable />);
      fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "30" } });
      expect(brokers()).toHaveLength(25);
      expect(screen.queryByText(/^Page /)).toBeNull();
    });

    it("goes back to page 1 when a filter changes", () => {
      render(<Table caption="Brokers" columns={columns} rows={many} pageable />);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: "Filter" }));
      fireEvent.input(screen.getByLabelText("Filter Broker"), { target: { value: "b-" } });
      expect(screen.getByText("Page 1 of 3")).toBeTruthy();
      expect(brokers()[0]).toBe("b-01");
    });

    it("goes back to page 1 when the sort changes", () => {
      render(<Table caption="Brokers" columns={columns} rows={many} pageable />);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: /Disk/ }));
      expect(screen.getByText("Page 1 of 3")).toBeTruthy();
      expect(brokers()[0]).toBe("b-01");
    });

    it("goes back to page 1 when rows per page changes", () => {
      render(<Table caption="Brokers" columns={columns} rows={many} pageable />);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "15" } });
      expect(screen.getByText("Page 1 of 2")).toBeTruthy();
      expect(brokers()[0]).toBe("b-01");
    });

    it("is off by default", () => {
      render(<Table caption="Brokers" columns={columns} rows={many} />);
      expect(brokers()).toHaveLength(25);
      expect(screen.queryByLabelText("Rows per page")).toBeNull();
    });
  });

  it("shows bytes with units", () => {
    render(<Table caption="Brokers" columns={columns} rows={[rows[1]]} />);
    expect(screen.getByText("1 GiB")).toBeTruthy();
  });
});
