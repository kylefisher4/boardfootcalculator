'use client';
import React, { useState, useCallback } from 'react';

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT = `You are a lumber material takeoff assistant. You will be given raw CSV text from a material list.

Your job is to:
1. Parse EVERY row that represents any solid lumber, timber, or engineered wood product (LVL, PSL, LSL, Glulam, I-Joist, etc.). No row with valid dimensions should be skipped or omitted. Use count+dimensions only. If a row provides linear feet, convert it silently: board_feet = (thickness_in x width_in / 12) x LF. Always record method as 'count'.
2. Calculate board footage for ALL items using this formula: (thickness_in x width_in / 12) x qty x length_ft. Example: 10 pieces of 2x10 at 10' = (2 x 10 / 12) x 10 x 10 = 167 BF. IMPORTANT: Always round each item's board_feet UP to the next highest whole number (ceiling). Subtotals and grand totals should be the sum of the already-rounded item values. Non-standard and EWP sizes (e.g. 2x14, 3.5x14, 1.75x9.5 LVL) must still be calculated — do not skip any row that has valid dimensions and a quantity.
3. Convert fractional dimensions (e.g. "1-3/4", "2 1/2") to decimal inches.
4. Use NOMINAL dimensions, NOT actual. A 2x4 uses thickness_in=2 and width_in=4. A 2x6 uses thickness_in=2 and width_in=6. A 1x4 uses thickness_in=1 and width_in=4. For EWP products (LVL, PSL, LSL, Glulam), ROUND BOTH THICKNESS AND WIDTH UP to the next whole number. For example, a 5-1/8" x 9-1/2" glulam uses thickness_in=6, width_in=10. A 1-3/4" x 9-1/4" LVL uses thickness_in=2, width_in=10. A 3-1/2" x 5-1/4" PSL uses thickness_in=4, width_in=6. I-Joists are the exception — use their stated dimensions as-is, do NOT round.
5. Parse length from inline descriptions. Patterns like "@ 8'", "@ 20'", "16 ft", "10'" all indicate board length in feet. Store length_ft as feet (NOT inches). Example: "2x14 @ 20'" means length_ft = 20.
6. Normalize inverted dimensions: if a dimension is given as e.g. 6x4, swap thickness and width so thickness is always the smaller value. Use nominal values (6x4 becomes thickness=4, width=6).
7. Group results by species/material. IMPORTANT GROUPING RULES: Any item with "LVL" anywhere in the description MUST be grouped under the label "LVL" — no exceptions, regardless of species. Any item that is an I-Joist (descriptions containing "I-Joist", "I Joist", "IJoist", "TJI", "BCI", "AJB", "LPI") or rimboard (descriptions containing "rimboard", "rim board") MUST be grouped under the label "I-Joist". Other EWP items (PSL, LSL, Glulam) should be grouped under their product type as the label. For standard lumber, group by species if given. Use 'General' as a last resort only.
8. INCLUDE all sheathing (wall sheathing, roof sheathing, subfloor, OSB panels, plywood panels, decking sheets, sheet goods, T&G/tongue-and-groove panels). Use the same board footage formula for sheet goods: (thickness_in x width_in / 12) x qty x length_ft. Sheet goods are typically 4' x 8' sheets, so width_in=48 and length_ft=8. ROUND THICKNESS UP to the next whole number for plywood and OSB. For example, 10 sheets of 1/2" 4x8 OSB: thickness rounds up to 1, so (1 x 48 / 12) x 10 x 8 = 320 BF. Another example: 15 sheets of 3/4" 4x8 plywood: thickness rounds up to 1, so (1 x 48 / 12) x 15 x 8 = 480 BF. If a description contains "T&G" or "tongue and groove", group it under 'Sheathing' (alongside OSB and Plywood), NOT as standard dimension lumber. Use the sheet dimensions (typically 4x8) and round thickness up. Group all sheathing under their material type (e.g. 'OSB', 'Plywood', 'Sheathing') or species if given.

CRITICAL: Your entire response must begin with { and end with }. No markdown, no backticks, no explanation. Just raw JSON.

Return ONLY raw JSON in this exact shape:
{
  "groups": [{
    "label": "Species or material name",
    "items": [{
      "description": "short description",
      "method": "count",
      "qty_or_lf": number,
      "thickness_in": number,
      "width_in": number,
      "length_ft": number,
      "board_feet": number
    }],
    "subtotal_bf": number
  }],
  "grand_total_bf": number,
  "notes": "warnings and assumptions"
}`

function stripPartIdColumn(csvText) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0) return csvText;
  const headers = lines[0].split(",");
  const idx = headers.findIndex(
    (h) => h.trim().toLowerCase().replace(/[^a-z]/g, "") === "partid"
  );
  if (idx === -1) return csvText;
  return lines.map((line) => {
    const cols = line.split(",");
    cols.splice(idx, 1);
    return cols.join(",");
  }).join("\n");
}

function parseCSVResult(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in response");
  return JSON.parse(text.slice(start, end + 1));
}

const NOMINAL_MAP = [
  { t: 1, w: 2,   label: '1x2',  category: 'standard' },
  { t: 1, w: 3,   label: '1x3',  category: 'standard' },
  { t: 1, w: 4,   label: '1x4',  category: 'standard' },
  { t: 1, w: 6,   label: '1x6',  category: 'standard' },
  { t: 1, w: 8,   label: '1x8',  category: 'standard' },
  { t: 1, w: 10,  label: '1x10', category: 'standard' },
  { t: 1, w: 12,  label: '1x12', category: 'standard' },
  { t: 2, w: 2,   label: '2x2',  category: 'standard' },
  { t: 2, w: 3,   label: '2x3',  category: 'standard' },
  { t: 2, w: 4,   label: '2x4',  category: 'standard' },
  { t: 2, w: 6,   label: '2x6',  category: 'standard' },
  { t: 2, w: 8,   label: '2x8',  category: 'standard' },
  { t: 2, w: 10,  label: '2x10', category: 'standard' },
  { t: 2, w: 12,  label: '2x12', category: 'heavy'    },
  { t: 2, w: 14,  label: '2x14', category: 'heavy'    },
  { t: 2, w: 16,  label: '2x16', category: 'heavy'    },
  { t: 3, w: 4,   label: '3x4',  category: 'heavy'    },
  { t: 3, w: 6,   label: '3x6',  category: 'heavy'    },
  { t: 4, w: 4,   label: '4x4',  category: 'heavy'    },
  { t: 4, w: 6,   label: '4x6',  category: 'heavy'    },
  { t: 4, w: 8,   label: '4x8',  category: 'heavy'    },
  { t: 4, w: 10,  label: '4x10', category: 'heavy'    },
  { t: 4, w: 12,  label: '4x12', category: 'heavy'    },
  { t: 6, w: 6,   label: '6x6',  category: 'heavy'    },
  { t: 6, w: 8,   label: '6x8',  category: 'heavy'    },
];

const STANDARD_ORDER = ['1x2','1x3','1x4','1x6','1x8','1x10','1x12','2x2','2x3','2x4','2x6','2x8','2x10'];
const HEAVY_ORDER    = ['2x12','2x14','2x16','3x4','3x6','4x4','4x6','4x8','4x10','4x12','6x6','6x8'];

const ENG_CATS = [
  { key: 'LVL',     kw: ['lvl','laminated veneer'] },
  { key: 'I-Joist', kw: ['ijoist','i-joist','i joist','tji','bci','ajb','lpi','rimboard','rim board','rim-board'] },
  { key: 'Glulam',  kw: ['glulam','glue-lam','glue lam','gl beam'] },
  { key: 'PSL/LSL', kw: ['psl','lsl','parallam','timberstrand','microllam'] },
  { key: 'OSB',     kw: ['osb'] },
  { key: 'Plywood', kw: ['plywood','ply','cdx','acx','bcx'] },
  { key: 'Sheathing', kw: ['sheathing','subfloor','sub-floor','decking sheet','t&g','tongue and groove','tongue & groove'] },
];

function getEngCat(desc, t, w) {
  const low = desc.toLowerCase();
  for (const c of ENG_CATS) if (c.kw.some(k => low.includes(k))) return c.key;
  // Unmapped dimensional lumber — use dimension string as the bucket label
  if (t && w) return `${t}" x ${w}"`;
  return 'Other';
}

function getDimInfo(t, w) {
  const normal = NOMINAL_MAP.find(n => Math.abs(n.t - t) < 0.3 && Math.abs(n.w - w) < 0.3);
  if (normal) return normal;
  return NOMINAL_MAP.find(n => Math.abs(n.t - w) < 0.3 && Math.abs(n.w - t) < 0.3) || null;
}

// Ensure thickness is always the smaller value so inverted dims merge with standard
function normalizeDims(t, w) {
  return t <= w ? [t, w] : [w, t];
}

function buildDimSummary(groups) {
  const std = {}, hvy = {}, eng = {};

  const add = (map, key, item) => {
    if (!map[key]) map[key] = { subtotal: 0, items: [] };
    const ex = map[key].items.find(i => i.description === item.description);
    if (ex) ex.bf = ex.bf + Math.ceil(item.board_feet);
    else map[key].items.push({ description: item.description, bf: Math.ceil(item.board_feet) });
    map[key].subtotal = map[key].subtotal + Math.ceil(item.board_feet);
  };

  // Keywords that force items into the engineered/specialty group regardless of dimensions
  const ENG_KEYWORDS = ['lvl','i-joist','i joist','ijoist','tji','bci','ajb','lpi','rimboard','rim board','rim-board','glulam','glue-lam','glue lam','gl beam','psl','lsl','parallam','timberstrand','microllam','osb','plywood','ply','cdx','acx','bcx','sheathing','subfloor','sub-floor','decking sheet','t&g','tongue and groove','tongue & groove'];

  for (const g of groups)
    for (const item of g.items) {
      const [nt, nw] = normalizeDims(item.thickness_in, item.width_in);
      const normItem = { ...item, thickness_in: nt, width_in: nw };
      const lowDesc = item.description.toLowerCase();
      // Check if description matches any engineered/specialty keyword FIRST
      if (ENG_KEYWORDS.some(kw => lowDesc.includes(kw))) {
        add(eng, getEngCat(item.description, nt, nw), normItem);
      } else {
        const d = getDimInfo(nt, nw);
        if (d && d.category === 'standard') add(std, d.label, normItem);
        else if (d && d.category === 'heavy') add(hvy, d.label, normItem);
        else add(eng, getEngCat(item.description, nt, nw), normItem);
      }
    }

  const sortGroup = (map, order) =>
    Object.entries(map)
      .sort(([a], [b]) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1; if (bi === -1) return -1;
        return ai - bi;
      })
      .map(([label, d]) => ({ label, subtotal: d.subtotal, items: d.items.sort((a, b) => b.bf - a.bf) }));

  return {
    std: sortGroup(std, STANDARD_ORDER),
    hvy: sortGroup(hvy, HEAVY_ORDER),
    eng: sortGroup(eng, []),
  };
}

export default function Page() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const readFile = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = () => rej(new Error('Failed to read file'));
    r.readAsText(file);
  });

  const handleFiles = useCallback((incoming) => {
    const csvFiles = Array.from(incoming).filter(f => f.type === 'text/csv' || f.name.endsWith('.csv'));
    if (!csvFiles.length) { setError('Please upload CSV files only.'); return; }
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...csvFiles.filter(f => !names.has(f.name))];
    });
    setError(null);
  }, []);

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); };
  const removeFile = (name) => { setFiles(prev => prev.filter(f => f.name !== name)); setResults(null); };

  const calculate = async () => {
    if (!files.length) return;
    setLoading(true); setError(null); setResults(null);
    try {
      const parts = await Promise.all(files.map(async f => {
        const text = await readFile(f);
        return '=== FILE: ' + f.name + ' ===\n' + stripPartIdColumn(text);
      }));
      const resp = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: parts.join('\n\n') }],
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const txt = data.content.map(b => b.text || '').join('');
      let parsed;
      try { parsed = parseCSVResult(txt); }
      catch (e) { throw new Error('AI response not valid JSON. Raw: "' + txt.slice(0, 300) + '..."'); }
      setResults(parsed);
    } catch (err) { setError('Failed to parse CSV. ' + err.message); }
    finally { setLoading(false); }
  };

  const reset = () => { setFiles([]); setResults(null); setError(null); };

  const exportCSV = () => {
    if (!results) return;
    const { std, hvy, eng } = buildDimSummary(results.groups);
    const clientTotal = results.groups.reduce((sum, g) => sum + g.subtotal_bf, 0);
    const rows = [];

    // ── By Dimension Summary ──────────────────────────────────────────────
    rows.push(['BY DIMENSION SUMMARY']);
    rows.push(['Section', 'Size / Label', 'Description', 'Board Feet', '% of Project']);

    const addSectionRows = (sectionName, sizeGroups) => {
      for (const sg of sizeGroups) {
        const pct = Math.round((sg.subtotal / clientTotal) * 100);
        rows.push([sectionName, sg.label, '', Math.ceil(sg.subtotal), pct + '%']);
        for (const item of sg.items) {
          const ipct = Math.round((item.bf / clientTotal) * 100);
          rows.push(['', '', item.description, Math.ceil(item.bf), ipct + '%']);
        }
      }
    };

    addSectionRows('Standard Dimension', std);
    addSectionRows('Heavy / Large Dimension (2x12+)', hvy);
    addSectionRows('Engineered / Specialty', eng);
    rows.push(['', '', 'PROJECT TOTAL', Math.ceil(clientTotal), '100%']);

    // ── Species Line-Item Detail ──────────────────────────────────────────
    rows.push([]);
    rows.push(['LINE-ITEM DETAIL BY SPECIES / MATERIAL']);
    rows.push(['Species / Label', 'Description', 'Qty', 'T (in)', 'W (in)', 'L (ft)', 'Board Feet']);

    for (const group of results.groups) {
      for (const item of group.items) {
        rows.push([
          group.label,
          item.description,
          item.qty_or_lf,
          item.thickness_in,
          item.width_in,
          item.length_ft ?? '',
          Math.ceil(item.board_feet),
        ]);
      }
      rows.push([group.label + ' SUBTOTAL', '', '', '', '', '', Math.ceil(group.subtotal_bf)]);
      rows.push([]);
    }

    if (results.notes) {
      rows.push(['NOTES']);
      rows.push([results.notes]);
    }

    // ── Serialize & download ──────────────────────────────────────────────
    const csv = rows.map(r =>
      r.map(cell => {
        const s = String(cell ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? '"' + s.replace(/"/g, '""') + '"'
          : s;
      }).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'board-footage-takeoff.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const TH = ({ children, right }) => (
    <th style={{ padding: '8px 14px', textAlign: right ? 'right' : 'left', color: '#5a5040', fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 'normal' }}>
      {children}
    </th>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a18', color: '#e8e0d0', fontFamily: "'Courier New', Courier, monospace" }}>

      <div style={{ borderBottom: '3px solid #c8a84b', padding: '24px 32px 20px', background: '#111110', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '10px', letterSpacing: '4px', color: '#c8a84b', marginBottom: '4px', textTransform: 'uppercase' }}>Material Takeoff</div>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700', letterSpacing: '1px', color: '#f0e8d8', textTransform: 'uppercase' }}>Board Footage Calculator</h1>
        </div>
        <div style={{ fontSize: '11px', color: '#786a50', textAlign: 'right', lineHeight: '1.6' }}>COUNT + DIMENSIONS</div>
      </div>

      <div style={{ padding: '32px', maxWidth: '960px', margin: '0 auto' }}>

        {!results && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('csv-input').click()}
            style={{ border: '2px dashed ' + (dragOver ? '#c8a84b' : '#3a3830'), borderRadius: '4px', padding: '48px 32px', textAlign: 'center', cursor: 'pointer', background: dragOver ? '#22211e' : '#14140f', transition: 'all 0.15s ease', marginBottom: '24px' }}
          >
            <input id='csv-input' type='file' accept='.csv' multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>ð</div>
            <div style={{ fontSize: '14px', color: '#c8a84b', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '8px' }}>Drop CSV Files Here</div>
            <div style={{ fontSize: '12px', color: '#5a5040' }}>or click to browse — multiple files supported</div>
          </div>
        )}

        {files.length > 0 && !results && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '10px', letterSpacing: '3px', color: '#786a50', marginBottom: '10px', textTransform: 'uppercase' }}>Queued Files</div>
            {files.map(f => (
              <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#1e1d18', border: '1px solid #2e2c24', borderRadius: '2px', marginBottom: '6px', fontSize: '13px' }}>
                <span style={{ color: '#d4c9b0' }}>ð {f.name}</span>
                <button onClick={() => removeFile(f.name)} style={{ background: 'none', border: 'none', color: '#5a5040', cursor: 'pointer', fontSize: '16px' }}>Ã</button>
              </div>
            ))}
            <button onClick={calculate} disabled={loading} style={{ marginTop: '16px', width: '100%', padding: '14px', background: loading ? '#3a3220' : '#c8a84b', color: loading ? '#786a50' : '#111110', border: 'none', borderRadius: '2px', fontSize: '13px', fontFamily: 'inherit', fontWeight: '700', letterSpacing: '3px', textTransform: 'uppercase', cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Calculating...' : 'Calculate Board Footage'}
            </button>
          </div>
        )}

        {error && <div style={{ background: '#2a1a1a', border: '1px solid #6a2a2a', borderRadius: '2px', padding: '14px 18px', fontSize: '13px', color: '#d07070', marginBottom: '20px' }}>⚠ {error}</div>}

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#786a50', fontSize: '12px', letterSpacing: '3px', textTransform: 'uppercase' }}>
            <div style={{ fontSize: '24px', marginBottom: '12px', animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>⚙️</div>
            <div>Parsing Material List...</div>
            <style>{'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
          </div>
        )}

        {results && (() => {
          const { std, hvy, eng } = buildDimSummary(results.groups);
          const clientTotal = results.groups.reduce((sum, g) => sum + g.subtotal_bf, 0);

          const SecHeader = ({ title }) => (
            <tr>
              <td colSpan={3} style={{ padding: '10px 14px 5px', color: '#c8a84b', fontSize: '9px', letterSpacing: '3px', textTransform: 'uppercase', background: '#111110', borderTop: '2px solid #2e2c24', fontWeight: '700' }}>
                {title}
              </td>
            </tr>
          );

          const SizeRow = ({ sg }) => (
            <React.Fragment>
              <tr style={{ background: '#1c1c18', borderTop: '1px solid #2a2820' }}>
                <td style={{ padding: '9px 14px', color: '#d4c9b0', fontWeight: '700', fontSize: '13px', letterSpacing: '1px' }}>{sg.label}</td>
                <td style={{ padding: '9px 14px', color: '#e8d898', textAlign: 'right', fontWeight: '700', fontSize: '13px' }}>
                  {sg.subtotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </td>
                <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                    <div style={{ width: '60px', height: '4px', background: '#2a2820', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: Math.round((sg.subtotal / clientTotal) * 100) + '%', height: '100%', background: '#c8a84b', borderRadius: '2px' }} />
                    </div>
                    <span style={{ color: '#c8a84b', fontSize: '11px', minWidth: '32px', textAlign: 'right', fontWeight: '700' }}>
                      {Math.round((sg.subtotal / clientTotal) * 100)}%
                    </span>
                  </div>
                </td>
              </tr>
              {sg.items.map((item, ii) => (
                <tr key={ii} style={{ borderBottom: '1px solid #1a1910', background: ii % 2 === 0 ? '#161510' : 'transparent' }}>
                  <td style={{ padding: '5px 14px 5px 30px', color: '#786a50', fontSize: '11px' }}>{item.description}</td>
                  <td style={{ padding: '5px 14px', color: '#b0a070', textAlign: 'right', fontSize: '11px' }}>
                    {item.bf.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ padding: '5px 14px', textAlign: 'right' }}>
                    <span style={{ color: '#4a4030', fontSize: '10px' }}>{Math.round((item.bf / clientTotal) * 100)}%</span>
                  </td>
                </tr>
              ))}
            </React.Fragment>
          );

          return (
            <div>
              <div style={{ background: '#c8a84b', color: '#111110', padding: '20px 28px', borderRadius: '2px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '10px', letterSpacing: '4px', textTransform: 'uppercase', opacity: 0.7, marginBottom: '2px' }}>Project Total</div>
                  <div style={{ fontSize: '32px', fontWeight: '700', letterSpacing: '1px' }}>
                    {clientTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} BF
                  </div>
                </div>
                <div style={{ fontSize: '11px', opacity: 0.6, textAlign: 'right' }}>{results.groups.length} GROUP{results.groups.length !== 1 ? 'S' : ''}</div>
              </div>

              <div style={{ background: '#14140f', border: '1px solid #2e2c24', borderRadius: '2px', marginBottom: '24px', overflow: 'hidden' }}>
                <div style={{ background: '#1e1d18', borderBottom: '1px solid #2e2c24', padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#d4c9b0', textTransform: 'uppercase', letterSpacing: '1px' }}>By Dimension</span>
                  <span style={{ fontSize: '10px', color: '#5a5040', letterSpacing: '2px', textTransform: 'uppercase' }}>All Species Combined</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #222018' }}>
                      <TH>Size / Description</TH>
                      <TH right>BF</TH>
                      <TH right>% of Project</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {std.length > 0 && <SecHeader title='Standard Dimension' />}
                    {std.map((sg, i) => <SizeRow key={i} sg={sg} />)}
                    {hvy.length > 0 && <SecHeader title='Heavy / Large Dimension (2x12+)' />}
                    {hvy.map((sg, i) => <SizeRow key={i} sg={sg} />)}
                    {eng.length > 0 && <SecHeader title='Engineered / Specialty' />}
                    {eng.map((sg, i) => <SizeRow key={i} sg={sg} />)}
                  </tbody>
                </table>
              </div>

              {results.groups.map((group, gi) => (
                <div key={gi} style={{ background: '#14140f', border: '1px solid #2e2c24', borderRadius: '2px', marginBottom: '16px', overflow: 'hidden' }}>
                  <div style={{ background: '#1e1d18', borderBottom: '1px solid #2e2c24', padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#d4c9b0', textTransform: 'uppercase', letterSpacing: '1px' }}>{group.label}</span>
                    <span style={{ fontSize: '14px', color: '#c8a84b', fontWeight: '700' }}>
                      {group.subtotal_bf.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} BF
                    </span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #222018' }}>
                        <TH>Description</TH>
                        <TH>Qty</TH>
                        <TH>T″</TH>
                        <TH>W″</TH>
                        <TH>L′</TH>
                        <TH right>BF</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, ii) => (
                        <tr key={ii} style={{ borderBottom: '1px solid #1e1d18', background: ii % 2 === 0 ? 'transparent' : '#16150f' }}>
                          <td style={{ padding: '8px 12px', color: '#c4b89a' }}>{item.description}</td>
                          <td style={{ padding: '8px 12px', color: '#a09070' }}>{item.qty_or_lf}</td>
                          <td style={{ padding: '8px 12px', color: '#a09070' }}>{item.thickness_in}</td>
                          <td style={{ padding: '8px 12px', color: '#a09070' }}>{item.width_in}</td>
                          <td style={{ padding: '8px 12px', color: '#a09070' }}>{item.length_ft ?? '—'}</td>
                          <td style={{ padding: '8px 12px', color: '#e8d898', textAlign: 'right', fontWeight: '700' }}>
                            {item.board_feet.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

              {results.notes && (
                <div style={{ background: '#1a1a14', border: '1px solid #3a3420', borderRadius: '2px', padding: '12px 16px', fontSize: '11px', color: '#786a50', marginBottom: '20px', lineHeight: '1.6' }}>
                  <span style={{ color: '#c8a84b', letterSpacing: '2px', fontSize: '9px', textTransform: 'uppercase' }}>Notes: </span>
                  {results.notes}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button onClick={exportCSV} style={{ flex: 1, padding: '12px', background: '#1e1d18', border: '1px solid #c8a84b', borderRadius: '2px', color: '#c8a84b', fontFamily: 'inherit', fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
                <button onClick={reset} style={{ flex: 1, padding: '12px', background: 'none', border: '1px solid #3a3830', borderRadius: '2px', color: '#786a50', fontFamily: 'inherit', fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer' }}>
                  ← New Calculation
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}