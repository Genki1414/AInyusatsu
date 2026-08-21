"use client";

// エリアのチェックボックス群。地方区分（AREA_OPTIONS）と都道府県を分けて表示する
// （optionsに両方混ざっていても、AREA_OPTIONSに含まれる値だけを地方区分として振り分ける）。
// 地方区分を選択/解除すると、その地方に属する都道府県も連動して選択/解除する。
import { useRef } from "react";
import { AREA_OPTIONS, REGION_PREFECTURES } from "@/lib/catalog";

const checkbox = "flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700";

export function AreaCheckboxGroup({ name, options, selected }: { name: string; options: readonly string[]; selected: string[] }) {
  const unique = Array.from(new Set(options));
  const regionOptions: readonly string[] = AREA_OPTIONS;
  const regions = unique.filter((a) => regionOptions.includes(a));
  const prefectures = unique.filter((a) => !regionOptions.includes(a));
  const groupRef = useRef<HTMLDivElement>(null);

  function handleRegionChange(region: string, checked: boolean) {
    const prefs = REGION_PREFECTURES[region as keyof typeof REGION_PREFECTURES];
    if (!prefs) return;
    const prefSet = new Set<string>(prefs);
    groupRef.current?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`).forEach((el) => {
      if (prefSet.has(el.value)) el.checked = checked;
    });
  }

  return (
    <div ref={groupRef} className="space-y-2">
      {regions.length > 0 && (
        <div>
          <div className="text-xs text-slate-500">地方区分</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {regions.map((a) => (
              <label key={a} className={checkbox}>
                <input
                  type="checkbox"
                  name={name}
                  value={a}
                  defaultChecked={selected.includes(a)}
                  onChange={(e) => handleRegionChange(a, e.target.checked)}
                />
                {a}
              </label>
            ))}
          </div>
        </div>
      )}
      {prefectures.length > 0 && (
        <div>
          <div className="text-xs text-slate-500">都道府県</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {prefectures.map((a) => (
              <label key={a} className={checkbox}>
                <input type="checkbox" name={name} value={a} defaultChecked={selected.includes(a)} />
                {a}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
