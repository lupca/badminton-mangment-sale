// Một chương trình ở dạng chỉ xem, cho vai trò không được sửa chương trình (sale): ba tab «Thông tin», «Danh mục sản
// phẩm» và «Quy tắc khuyến mãi» chỉ có chữ. Các thành phần ở đây không nhận hàm sửa nào và không có ô nhập hay nút
// sửa, nên không thể đổi chương trình từ màn hình này, kể cả bằng bàn phím.
import { Fragment, type ReactNode } from "react";
import { Download } from "lucide-react";
import type { ProductGroup, ProductItem, Program, Rule, TierGiftRule } from "../../types";
import { priceOf, sortTiers } from "../../lib/engine";
import { formatNumber, formatPeriod, formatVND, normalizeSku } from "../../lib/format";
import { PRICE_BASIS_LABEL, RULE_TYPE_LABEL, describeRule, describeTier, validateRule } from "../../lib/programOps";
import { Badge, Button, Card, EmptyState, Notice, cx, numCls, tableCls, tableWrapCls, tdCls, thCls } from "../../ui";
import SaleRoleNote from "./SaleRoleNote";
import { hintCls, legendCls } from "./fields";
import { ItemsBrowser, exportGroupExcel, useItemsView } from "./groupItems";
import { programTitle } from "./programActions";

const BLANK = <span className="text-gray-400">—</span>;

// ───────────────────────── Thông tin ─────────────────────────

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sm:flex sm:gap-4">
      <dt className="shrink-0 text-sm font-medium text-gray-700 sm:w-40">{label}</dt>
      {/* Ghi chú có thể nhiều dòng: giữ nguyên chỗ xuống dòng người quản lý đã gõ. */}
      <dd className="min-w-0 whitespace-pre-line break-words text-sm text-gray-900">{children}</dd>
    </div>
  );
}

function InfoView({ program }: { program: Program }) {
  return (
    <Card>
      <dl className="space-y-3">
        <Fact label="Tên chương trình">{programTitle(program)}</Fact>
        <Fact label="Hãng">{program.brand.trim() || BLANK}</Fact>
        <Fact label="Thời gian áp dụng">{formatPeriod(program.startDate, program.endDate)}</Fact>
        <Fact label="Ghi chú">{program.note.trim() || BLANK}</Fact>
      </dl>
    </Card>
  );
}

// ───────────────────────── Danh mục sản phẩm ─────────────────────────

const ITEM_COLUMNS = 5;

/**
 * Bảng sản phẩm chỉ có chữ. Màn hình hẹp: mỗi sản phẩm chiếm hai dòng — mã và hai giá ở dòng trên, tên hàng (và ghi
 * chú) trải hết bề ngang ở dòng dưới — để không phải kéo ngang bảng mới thấy giá. Trên điện thoại bảng còn tràn ra
 * sát mép khung (bù phần lề `p-4` của Card) và hai cột giá sát nhau hơn, cho mã hàng dài và hai giá vẫn vừa một hàng.
 */
function ItemsTable({ items }: { items: ProductItem[] }) {
  const th = cx(thCls, "max-md:px-2");
  const td = cx(tdCls, "max-md:border-b-0 max-md:px-2 max-md:pb-0");
  const price = cx(numCls, "max-sm:pl-1");
  return (
    <div className={cx(tableWrapCls, "max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0")}>
      <table className={tableCls}>
        <thead>
          <tr>
            <th className={cx(th, "max-md:whitespace-normal")}>
              Mã hàng<span className="md:hidden"> / Tên hàng</span>
            </th>
            <th className={cx(th, "max-md:hidden")}>Tên hàng</th>
            <th className={cx(th, price)}>Giá lẻ</th>
            <th className={cx(th, price)}>Giá sỉ</th>
            <th className={cx(th, "max-md:hidden")}>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {/* key theo vị trí: dòng không có trạng thái riêng, và dữ liệu nhập từ file có thể trùng mã */}
          {items.map((item, index) => (
            <Fragment key={index}>
              <tr className="md:hover:bg-gray-50">
                <td className={cx(td, "whitespace-nowrap font-medium")}>{item.sku}</td>
                <td className={cx(td, "min-w-48 max-md:hidden")}>{item.name}</td>
                <td className={cx(td, price)}>{formatVND(item.retailPrice)}</td>
                <td className={cx(td, price)}>{formatVND(item.wholesalePrice)}</td>
                <td className={cx(td, "text-gray-600 max-md:hidden")}>{item.note}</td>
              </tr>
              <tr className="md:hidden">
                <td colSpan={ITEM_COLUMNS} className="border-b border-gray-100 px-2 pb-2 pt-0.5 text-gray-600">
                  {item.name}
                  {item.note ? <span className="block text-gray-500">Ghi chú: {item.note}</span> : null}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupView({ group, programName }: { group: ProductGroup; programName: string }) {
  const { items } = group;
  const view = useItemsView(items);
  return (
    <Card
      title={
        <>
          {group.name.trim() || "(chưa đặt tên)"}
          <span className="font-normal text-gray-500"> · {formatNumber(items.length)} sản phẩm</span>
        </>
      }
      actions={
        <Button size="sm" onClick={() => exportGroupExcel(programName, group)} disabled={items.length === 0}>
          <Download className="h-3.5 w-3.5" /> Xuất Excel
        </Button>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-gray-600">Danh mục chưa có sản phẩm.</p>
      ) : (
        <ItemsBrowser items={items} view={view}>
          <ItemsTable items={view.visible} />
        </ItemsBrowser>
      )}
    </Card>
  );
}

function GroupsView({ program }: { program: Program }) {
  if (program.groups.length === 0) {
    return (
      <EmptyState
        title="Chương trình chưa có danh mục sản phẩm nào"
        hint="Người quản lý chưa nhập danh mục sản phẩm cho chương trình này."
      />
    );
  }
  return (
    <div className="space-y-4">
      {program.groups.map((group) => (
        <GroupView key={group.id} group={group} programName={program.name} />
      ))}
    </div>
  );
}

// ───────────────────────── Quy tắc khuyến mãi ─────────────────────────

/** Các mức của quy tắc «đạt doanh số → tặng hàng», mỗi mức một dòng. Mức chỉ được chọn một số mã quà thì mở ra xem được. */
function TierList({ rule, groups }: { rule: TierGiftRule; groups: ProductGroup[] }) {
  const tiers = sortTiers(rule.tiers);
  const giftItems = groups.find((group) => group.id === rule.giftGroupId)?.items ?? [];
  if (tiers.length === 0) return null;
  return (
    <div>
      <p className={legendCls}>Các mức doanh số</p>
      <ol className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm text-gray-800">
        {tiers.map((tier, i) => {
          const allowed = tier.allowedSkus ? new Set(tier.allowedSkus.map(normalizeSku)) : null;
          const allowedItems = allowed ? giftItems.filter((item) => allowed.has(normalizeSku(item.sku))) : [];
          return (
            <li key={tier.id} className="px-3 py-2">
              {describeTier(tier, tiers[i + 1] ?? null)}
              {allowedItems.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-blue-700 hover:underline">
                    Xem {allowedItems.length} mã quà được chọn
                  </summary>
                  <ul className="mt-1 divide-y divide-gray-100 border-t border-gray-100">
                    {allowedItems.map((item, index) => (
                      <li key={index} className="flex items-start justify-between gap-3 py-1.5">
                        <span className="min-w-0">
                          <span className="font-medium max-sm:block">{item.sku}</span>{" "}
                          <span className="text-gray-700">{item.name}</span>
                        </span>
                        <span className="whitespace-nowrap tabular-nums text-gray-700">
                          {formatVND(priceOf(item, rule.giftPriceBasis))}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className={hintCls}>
                    Giá bên phải là {PRICE_BASIS_LABEL[rule.giftPriceBasis]}, loại giá dùng để tính giá trị quà.
                  </p>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RuleView({ rule, index, groups }: { rule: Rule; index: number; groups: ProductGroup[] }) {
  const [headline, ...details] = describeRule(rule, groups);
  const problems = validateRule(rule, groups);
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {rule.name.trim() || `Quy tắc ${index + 1}`} <Badge tone="blue">{RULE_TYPE_LABEL[rule.type]}</Badge>
          {problems.length > 0 ? <Badge tone="amber">Chưa hoàn chỉnh</Badge> : null}
        </span>
      }
      bodyClassName="space-y-3"
    >
      <p className="text-sm text-gray-800">{headline}</p>

      {rule.type === "tier_gift" ? (
        <TierList rule={rule} groups={groups} />
      ) : details.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-800">
          {details.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}

      {problems.length > 0 ? (
        <Notice tone="warning">
          <p className="font-medium">Quy tắc chưa hoàn chỉnh, cần người quản lý sửa:</p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((problem, i) => (
              <li key={i}>{problem}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </Card>
  );
}

function RulesView({ program }: { program: Program }) {
  if (program.rules.length === 0) {
    return (
      <EmptyState
        title="Chương trình chưa có quy tắc khuyến mãi nào"
        hint="Đơn hàng của chương trình này được tính theo giá sỉ, chưa có khuyến mãi."
      />
    );
  }
  return (
    <div className="space-y-4">
      {program.rules.map((rule, index) => (
        <RuleView key={rule.id} rule={rule} index={index} groups={program.groups} />
      ))}
    </div>
  );
}

// ───────────────────────── Cả ba tab ─────────────────────────

export default function ProgramReadOnly({ program, tab }: { program: Program; tab: "info" | "groups" | "rules" }) {
  return (
    <>
      {tab === "info" ? <InfoView program={program} /> : null}
      {tab === "groups" ? <GroupsView program={program} /> : null}
      {tab === "rules" ? <RulesView program={program} /> : null}

      <p className="mt-4 text-xs text-gray-500 print:hidden">
        <SaleRoleNote />
      </p>
    </>
  );
}
