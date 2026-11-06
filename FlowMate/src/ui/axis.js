/* Axis settings. The transform type is a property of the channel (applies to every plot);
 * the range belongs to one plot and is framed automatically on the population it shows. */
(function (FM) {
  'use strict';
  const { h, popover } = FM.dom;
  const T = FM.transforms;

  const TYPES = [['lin', 'Lin'], ['log', 'Log'], ['logicle', 'Logicle'], ['asinh', 'Asinh'], ['biex', 'Biex']];

  function pooledValues(param) {
    const out = [];
    FM.ws.samples.forEach(s => {
      const c = s.data[param]; if (!c) return;
      const step = Math.max(1, Math.floor(c.length / 3000));
      for (let i = 0; i < c.length; i += step) out.push(c[i]);
    });
    return out.sort((a, b) => a - b);
  }

  /** A spec of `type` for a parameter over all events (used for the global default). */
  function specForType(type, info, values) {
    const v = values.slice().sort((a, b) => a - b);
    if (type === 'logicle' || type === 'biex') {
      const d = T.defaultScale(Object.assign({}, info, { displayHint: 'log' }), v);
      // FlowJo's default biex: width basis −10, 4.42 positive decades, top at the logicle T
      if (type === 'biex') return { type: 'biex', neg: 0, width: -10, pos: 4.418540, max: d.type === 'logicle' ? d.T : 262144 };
      if (d.type === 'logicle') return d;
    }
    return FM.autofit.fitSpec(type, v, { cofactor: 150 }) || { type: 'lin', min: 0, max: 1 };
  }

  /** Switch a channel's transform everywhere; each plot re-frames itself in the new type. */
  function setType(param, type) {
    const ws = FM.ws;
    const cur = ws.scaleSpec(param);
    if (cur.type === type) return;
    ws.setParamType(param, specForType(type, ws.paramInfo(param), pooledValues(param)));
  }

  function numField(label, value, onChange, hint) {
    const inp = h('input.input.sm.mono', { type: 'text', value: fmt(value), inputmode: 'decimal', on: {
      change: () => { const n = parse(inp.value); if (Number.isFinite(n)) { inp.classList.remove('bad'); onChange(n); } else inp.classList.add('bad'); },
      keydown: e => { if (e.key === 'Enter') inp.dispatchEvent(new Event('change')); },
    } });
    return h('div.field', h('label', label, hint ? h('span.faint', ' ' + hint) : null), inp);
  }
  function fmt(v) { return Number.isFinite(v) ? (Math.abs(v) >= 1e5 ? v.toExponential(2).replace('e+', 'e') : String(Math.round(v * 1000) / 1000)) : ''; }
  function parse(s) {
    s = String(s).trim().replace(/,/g, '').toLowerCase();
    const m = /^(-?[\d.]+(?:e[-+]?\d+)?)\s*([kmg])?$/.exec(s);
    if (!m) return NaN;
    return parseFloat(m[1]) * ({ k: 1e3, m: 1e6, g: 1e9 }[m[2]] || 1);
  }

  /** Popover for one axis of the plot of population `popId`. */
  function open(anchor, param, popId) {
    const W = FM.ws;
    const body = h('div.axis-pop');
    const draw = () => {
      FM.dom.clear(body);
      const spec = W.viewScale(popId, param);
      const setRange = patch => {
        const next = Object.assign({}, W.viewScale(popId, param), patch);
        try { if (next.type === 'logicle') new T.Logicle(next.T, next.W, next.M, next.A || 0); }
        catch (e) { FM.dom.toast(e.message.replace('logicle: ', 'Logicle: '), { level: 'crit' }); return; }
        W.setViewRange(popId, param, next);
        draw();
      };
      body.appendChild(h('div.axis-head',
        h('div', h('div.eyebrow', 'Axis'), h('div.axis-name.mono', param)),
        h('div.seg', TYPES.map(([t, l]) => h('button' + (spec.type === t ? '.on' : ''), { on: { click: () => { setType(param, t); draw(); } } }, l))),
        h('p.muted.small.axis-note', 'The transform applies to ' + param + ' in every plot.')));
      const fields = h('div.axis-fields');
      if (spec.type === 'lin' || spec.type === 'log') {
        fields.appendChild(numField('From', spec.min, v => setRange({ min: v })));
        fields.appendChild(numField('To', spec.max, v => setRange({ max: v })));
      } else if (spec.type === 'logicle') {
        fields.appendChild(numField('Top (T)', spec.T, v => setRange({ T: v }), 'data units'));
        fields.appendChild(numField('Linear width (W)', spec.W, v => setRange({ W: v }), 'decades'));
        fields.appendChild(numField('Decades (M)', spec.M, v => setRange({ M: v })));
        fields.appendChild(numField('Extra negative (A)', spec.A || 0, v => setRange({ A: v })));
      } else if (spec.type === 'biex') {
        fields.appendChild(numField('Width basis', spec.width, v => setRange({ width: Math.min(-1, v) }), 'FlowJo, negative'));
        fields.appendChild(numField('Positive decades', spec.pos, v => setRange({ pos: v })));
        fields.appendChild(numField('Negative decades', spec.neg, v => setRange({ neg: Math.max(0, v) })));
        fields.appendChild(numField('Top', spec.max, v => setRange({ max: v }), 'data units'));
      } else {
        fields.appendChild(numField('Cofactor', spec.cofactor, v => setRange({ cofactor: v })));
        fields.appendChild(numField('From', spec.min, v => setRange({ min: v })));
        fields.appendChild(numField('To', spec.max, v => setRange({ max: v })));
      }
      body.appendChild(h('div.eyebrow.axis-sub', 'Range in this plot'));
      body.appendChild(fields);
      body.appendChild(h('div.row.axis-actions',
        h('button.btn.sm.primary', { 'data-tip': 'Frame this axis on the events in ' + W.popName(popId), on: { click: () => { W.refitView(popId, [param]); draw(); } } }, 'Fit to population'),
        spec.type === 'logicle' ? h('button.btn.sm', { 'data-tip': 'W from the 5th percentile of negative values (Parks et al.)', on: { click: () => {
          setRange({ W: T.autoLogicleW(FM.autofit.pooled(W, popId, param), spec.T, spec.M) });
        } } }, 'Auto W') : null));
      body.appendChild(h('p.muted.small.axis-note', 'Gates keep the scale they were drawn on, so changing an axis never changes a result.'));
    };
    draw();
    return popover(anchor, body, { width: 340 });
  }

  /** A compact type chip for a toolbar: shows the transform and opens the axis popover. */
  function chip(param, popId) {
    const spec = FM.ws.viewScale(popId, param);
    const label = (TYPES.find(t => t[0] === spec.type) || ['', spec.type])[1];
    return h('button.btn.sm.axis-chip', { 'data-tip': 'Axis scale for ' + param + ' — transform and range', on: { click: e => open(e.currentTarget, param, popId) } }, label);
  }

  FM.axisUI = { open, chip, setType, specForType, pooledValues, parseNumber: parse, TYPES };
})(FM);
