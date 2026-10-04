import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Search } from "lucide-react";
import { PaneSplitter } from "../components/PaneSplitter";
import { usePaneSize } from "../hooks/usePaneSize";
import { useI18n } from "../i18n/I18nContext";
import { logWarn, serializeError } from "../services/logger";
import {
  onRecordsChanged,
  readRecordDetail,
  readRecordSources,
  readRecordsPage,
  RECORD_LEVEL_FILTERS,
  saveRecordsListWidth,
  type RecordDetail,
  type RecordLevelFilter,
  type RecordSources,
  type RecordsQuery,
  type RecordSummary,
} from "../services/records";
import { indexOfId, listboxDirection, nextIndex } from "../utils/compositeNav";
import {
  cursorAfter,
  formatStoredTime,
  isEmptyStoredValue,
  knownLevel,
  LEVEL_FILTER_LABELS,
  LEVEL_LABELS,
  mergeNewestPage,
  prettyJson,
} from "./recordFormat";
import { RECORDS_LIST_SIBLING_MIN, RECORDS_LIST_WIDTH } from "./recordsLayout";

type Filters = Omit<RecordsQuery, "after">;

const NO_FILTERS: Filters = { session: null, level: null, search: "" };
const SEARCH_DELAY_MS = 300;
// New records are read at most this often while they keep arriving.
const LIVE_INTERVAL_MS = 1000;

type ListState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; records: RecordSummary[]; more: boolean; loadingMore: boolean; moreFailed: boolean };

type DetailState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; record: RecordDetail };

// Within about one screen of the end of what is loaded.
function nearEnd(scroll: HTMLElement): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= scroll.clientHeight;
}

function atTop(scroll: HTMLElement): boolean {
  return scroll.scrollTop < 1;
}

function rowKey(id: number): string {
  return String(id);
}

export function RecordsWindow({ initialListWidth }: { initialListWidth: number }) {
  const { t, locale } = useI18n();
  const [sources, setSources] = useState<RecordSources | null>(null);
  const [sourceReads, setSourceReads] = useState(0);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [composingSearch, setComposingSearch] = useState(false);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "none" });
  const [listWidth, setListWidth] = useState(initialListWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const listGeneration = useRef(0);
  // The busy claim for the next page (PLAYBOOK, Own the work in flight).
  const fetchingMore = useRef(false);
  // The filters the current list was read for, for the live reads below.
  const filtersRef = useRef(filters);
  // New records arrived while the list was scrolled away from the top.
  const newestPending = useRef(false);
  // A failed read is itself logged as a record, whose signal would start the
  // next read; live reads stop after a failure and resume after a read succeeds.
  const liveSuspended = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { containerRef: shellRef, displayed: shownListWidth } = usePaneSize(dragWidth ?? listWidth, {
    siblingMin: RECORDS_LIST_SIBLING_MIN,
    min: RECORDS_LIST_WIDTH.min,
    max: RECORDS_LIST_WIDTH.max,
  });

  const timeFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }), [locale]);

  // The search applies once typing pauses, and never on an unfinished IME
  // composition.
  useEffect(() => {
    if (composingSearch) return undefined;
    const timer = setTimeout(() => {
      setFilters((current) => (current.search === searchText ? current : { ...current, search: searchText }));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, composingSearch]);

  useEffect(() => {
    let cancelled = false;
    void readRecordSources().then(
      (next) => {
        if (!cancelled) setSources(next);
      },
      (error: unknown) => {
        liveSuspended.current = true;
        logWarn("record sources read failed", { error: serializeError(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sourceReads]);

  // A page applies only while the filters it was read for are still the newest
  // ones asked for.
  useEffect(() => {
    filtersRef.current = filters;
    const generation = ++listGeneration.current;
    fetchingMore.current = false;
    newestPending.current = false;
    setList({ status: "loading" });
    void readRecordsPage({ ...filters, after: null }).then(
      (page) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = false;
        setList({ status: "ready", records: page.records, more: page.more, loadingMore: false, moreFailed: false });
      },
      (error: unknown) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = true;
        logWarn("records read failed", { error: serializeError(error) });
        setList({ status: "failed" });
      },
    );
  }, [filters]);

  // The newest page read again for new records. It joins the rows already shown
  // rather than replacing them, so the list never falls back to the loading note
  // and the pages already read stay. It reads only refs, so one copy serves the
  // live subscription below.
  const readNewest = useCallback(() => {
    const generation = listGeneration.current;
    void readRecordsPage({ ...filtersRef.current, after: null }).then(
      (page) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = false;
        setList((current) =>
          current.status === "ready"
            ? { ...current, ...mergeNewestPage(current.records, current.more, page) }
            : { status: "ready", records: page.records, more: page.more, loadingMore: false, moreFailed: false },
        );
      },
      (error: unknown) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = true;
        logWarn("records read failed", { error: serializeError(error) });
      },
    );
  }, []);

  // A stored record reaches the list at once while it is scrolled to the top;
  // otherwise it waits until the list is back there, so the list never moves
  // under the reader.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onRecordsChanged(() => {
      if (timer !== null || liveSuspended.current) return;
      timer = setTimeout(() => {
        timer = null;
        setSourceReads((count) => count + 1);
        const scroll = scrollRef.current;
        if (scroll === null || atTop(scroll)) readNewest();
        else newestPending.current = true;
      }, LIVE_INTERVAL_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [readNewest]);

  useEffect(() => {
    if (selectedId === null) {
      setDetail({ status: "none" });
      return undefined;
    }
    let cancelled = false;
    setDetail({ status: "loading" });
    void readRecordDetail(selectedId).then(
      (record) => {
        if (!cancelled) setDetail(record === null ? { status: "failed" } : { status: "ready", record });
      },
      (error: unknown) => {
        if (cancelled) return;
        logWarn("record read failed", { error: serializeError(error) });
        setDetail({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Loading more: composite-control-conventions, Integration Points. A failed
  // page is read again when the end is reached again.
  const loadMore = () => {
    if (list.status !== "ready" || !list.more || fetchingMore.current) return;
    fetchingMore.current = true;
    const generation = listGeneration.current;
    setList((current) => (current.status === "ready" ? { ...current, loadingMore: true, moreFailed: false } : current));
    void readRecordsPage({ ...filters, after: cursorAfter(list.records) }).then(
      (page) => {
        if (generation !== listGeneration.current) return;
        fetchingMore.current = false;
        liveSuspended.current = false;
        setList((current) =>
          current.status === "ready"
            ? { ...current, records: [...current.records, ...page.records], more: page.more, loadingMore: false }
            : current,
        );
      },
      (error: unknown) => {
        if (generation !== listGeneration.current) return;
        fetchingMore.current = false;
        liveSuspended.current = true;
        logWarn("records read failed", { error: serializeError(error) });
        setList((current) => (current.status === "ready" ? { ...current, loadingMore: false, moreFailed: true } : current));
      },
    );
  };

  // A page that leaves the list short of the end reads the next one; a failed
  // page waits for the reader instead.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (list.status !== "ready" || list.loadingMore || list.moreFailed || scroll === null) return;
    if (nearEnd(scroll)) loadMore();
    // Only a new list state can change what is loaded.
  }, [list]);

  const onListScroll = () => {
    const scroll = scrollRef.current;
    if (scroll === null) return;
    if (newestPending.current && atTop(scroll)) {
      newestPending.current = false;
      readNewest();
    }
    if (nearEnd(scroll)) loadMore();
  };

  const records = list.status === "ready" ? list.records : [];
  const keys = records.map((record) => rowKey(record.id));
  const selectedKey = selectedId === null ? null : rowKey(selectedId);
  const tabStopKey = selectedKey !== null && keys.includes(selectedKey) ? selectedKey : (keys[0] ?? null);

  const select = (record: RecordSummary) => {
    if (record.id !== selectedId) setSelectedId(record.id);
  };

  // The list is one listbox (composite-control-conventions, Listbox); the
  // selection follows focus.
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return;
    const direction = listboxDirection(event.key);
    if (direction === null) return;
    event.preventDefault();
    const container = listRef.current;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.recordId : undefined;
    const current = indexOfId(keys, focused ?? selectedKey);
    const firstOption = container?.querySelector<HTMLElement>("[data-record-id]");
    const viewport = scrollRef.current?.clientHeight ?? 0;
    const pageStep = firstOption?.offsetHeight ? Math.max(1, Math.floor(viewport / firstOption.offsetHeight)) : 8;
    const target = nextIndex(direction, current, keys.length, pageStep);
    if (target < 0) return;
    const option = container?.querySelector<HTMLElement>(`[data-record-id="${CSS.escape(keys[target])}"]`);
    option?.focus();
    option?.scrollIntoView?.({ block: "nearest" });
    if (target === keys.length - 1 && (direction === "next" || direction === "page-next" || direction === "last")) {
      loadMore();
    }
  };

  // Drag intent: window-conventions, Content-based minimum size.
  const commitListWidth = (width: number) => {
    setListWidth(width);
    setDragWidth(null);
    void saveRecordsListWidth(width).catch((error: unknown) =>
      logWarn("records list width save failed", { width, error: serializeError(error) }),
    );
  };

  const launchLabel = (session: string): string => {
    const time = formatStoredTime(session, timeFormat);
    return session === sources?.currentSession ? t("records.thisLaunch", { time }) : time;
  };

  return (
    <div
      ref={shellRef}
      className="recordsShell"
      style={{ "--records-list-width": `${shownListWidth}px` } as CSSProperties}
    >
      <section className="recordsPane recordsListPane" aria-label={t("records.title")}>
        <div className="recordsFilters">
          <div className="searchBox">
            <Search size={16} />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onCompositionStart={() => setComposingSearch(true)}
              onCompositionEnd={() => setComposingSearch(false)}
              placeholder={t("records.search")}
              aria-label={t("records.search")}
            />
          </div>
          <div className="recordsFiltersRow">
            <FilterSelect
              label={t("records.launch")}
              value={filters.session}
              allLabel={t("records.allLaunches")}
              options={(sources?.sessions ?? []).map((session) => ({ value: session, label: launchLabel(session) }))}
              onChange={(session) => setFilters({ ...filters, session })}
            />
            <FilterSelect
              label={t("records.level")}
              value={filters.level}
              allLabel={t("records.allLevels")}
              options={RECORD_LEVEL_FILTERS.map((level) => ({ value: level, label: t(LEVEL_FILTER_LABELS[level]) }))}
              onChange={(level) => setFilters({ ...filters, level: level as RecordLevelFilter | null })}
            />
          </div>
        </div>
        <div
          ref={scrollRef}
          className="recordsListScroll"
          aria-busy={list.status === "loading"}
          onScroll={onListScroll}
        >
          {list.status === "failed" ? (
            <p className="recordsNote errorText" role="alert">{t("records.loadFailed")}</p>
          ) : list.status === "loading" ? (
            <p className="recordsNote">{t("records.loading")}</p>
          ) : records.length === 0 ? (
            <p className="recordsNote">{t("records.empty")}</p>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              aria-label={t("records.title")}
              className="recordsList"
              onKeyDown={onListKeyDown}
            >
              {records.map((record) => {
                const key = rowKey(record.id);
                const level = knownLevel(record.level);
                return (
                  <div
                    key={key}
                    role="option"
                    aria-selected={key === selectedKey}
                    tabIndex={key === tabStopKey ? 0 : -1}
                    data-record-id={key}
                    className={`recordsRow${key === selectedKey ? " recordsRow-selected" : ""}`}
                    onClick={() => select(record)}
                    onFocus={() => select(record)}
                  >
                    <span className="recordsRowMeta">
                      <span>{formatStoredTime(record.time, timeFormat)}</span>
                      <span className={`recordsLevel recordsLevel-${level ?? "other"}`}>
                        {level === null ? record.level : t(LEVEL_LABELS[level])}
                      </span>
                    </span>
                    <span className="recordsRowTitle">{record.message}</span>
                    {record.op !== null ? <span className="recordsRowText">{record.op}</span> : null}
                  </div>
                );
              })}
            </div>
          )}
          {list.status === "ready" && list.loadingMore ? <p className="recordsNote">{t("records.loading")}</p> : null}
          {list.status === "ready" && list.moreFailed ? (
            <p className="recordsNote errorText" role="alert">{t("records.loadFailed")}</p>
          ) : null}
        </div>
      </section>
      <PaneSplitter
        label={t("records.resizeList")}
        width={shownListWidth}
        min={RECORDS_LIST_WIDTH.min}
        max={RECORDS_LIST_WIDTH.max}
        onResize={setDragWidth}
        onCommit={commitListWidth}
      />
      <section className="recordsPane recordsDetailPane" aria-busy={detail.status === "loading"}>
        {detail.status === "ready" ? (
          <RecordDetailView record={detail.record} launchLabel={launchLabel} />
        ) : (
          <p className={`recordsNote${detail.status === "failed" ? " errorText" : ""}`}>
            {detail.status === "failed" ? t("records.detailFailed") : detail.status === "none" ? t("records.noSelection") : null}
          </p>
        )}
      </section>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  // A chosen value the sources no longer list stays selectable until changed.
  const shown =
    value === null || options.some((option) => option.value === value) ? options : [{ value, label: value }, ...options];
  return (
    <select
      className="recordsSelect"
      aria-label={label}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      <option value="">{allLabel}</option>
      {shown.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function RecordDetailView({
  record,
  launchLabel,
}: {
  record: RecordDetail;
  launchLabel: (session: string) => string;
}) {
  const { t, locale } = useI18n();
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      }),
    [locale],
  );
  const time = formatStoredTime(record.time, timeFormat);
  const level = knownLevel(record.level);

  const fields: { label: string; value: ReactNode }[] = [
    { label: t("records.time"), value: time },
    { label: t("records.launch"), value: launchLabel(record.session) },
  ];
  if (record.paneId !== null) fields.push({ label: t("records.pane"), value: <code>{record.paneId}</code> });
  if (record.snapshotId !== null) fields.push({ label: t("records.snapshot"), value: <code>{record.snapshotId}</code> });

  return (
    <>
      <div className="recordsDetailBar">
        <h2 className="recordsDetailTitle">{record.message}</h2>
        <span className={`recordsLevel recordsLevel-${level ?? "other"}`}>
          {level === null ? record.level : t(LEVEL_LABELS[level])}
        </span>
      </div>
      <div className="recordsDetailBody" role="region" tabIndex={0} aria-label={t("records.details")}>
        <dl className="recordsMeta">
          {fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
        {isEmptyStoredValue(record.fields) ? null : (
          <section className="recordsBlock">
            <h3 className="recordsBlockLabel">{t("records.details")}</h3>
            <pre className="recordsBlockText">{prettyJson(record.fields)}</pre>
          </section>
        )}
      </div>
    </>
  );
}
