/* Small dense linear algebra for regression, ANOVA and PCA (matrices are arrays of row arrays). */
(function (PM) {
  'use strict';

  function zeros(r, c) { const m = new Array(r); for (let i = 0; i < r; i++) m[i] = new Float64Array(c); return m; }
  function eye(n) { const m = zeros(n, n); for (let i = 0; i < n; i++) m[i][i] = 1; return m; }
  function transpose(A) { const r = A.length, c = A[0].length, T = zeros(c, r); for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = A[i][j]; return T; }
  function mul(A, B) {
    const r = A.length, n = B.length, c = B[0].length, C = zeros(r, c);
    for (let i = 0; i < r; i++) for (let k = 0; k < n; k++) { const a = A[i][k]; if (a === 0) continue; const Bk = B[k]; const Ci = C[i]; for (let j = 0; j < c; j++) Ci[j] += a * Bk[j]; }
    return C;
  }
  function mulVec(A, v) { return A.map(row => { let s = 0; for (let j = 0; j < v.length; j++) s += row[j] * v[j]; return s; }); }
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  /** XᵀWX and XᵀWy (W diagonal weights, default 1). */
  function normalEq(X, y, w) {
    const n = X.length, p = X[0].length;
    const XtX = zeros(p, p), Xty = new Float64Array(p);
    for (let i = 0; i < n; i++) {
      const wi = w ? w[i] : 1, xi = X[i];
      for (let a = 0; a < p; a++) {
        const v = wi * xi[a];
        if (v === 0) continue;
        Xty[a] += v * y[i];
        for (let b = a; b < p; b++) XtX[a][b] += v * xi[b];
      }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    return { XtX, Xty };
  }

  /** Cholesky factor L (A = L Lᵀ) of a symmetric positive-definite matrix, or null. */
  function cholesky(A) {
    const n = A.length, L = zeros(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) { if (!(s > 0)) return null; L[i][i] = Math.sqrt(s); }
        else L[i][j] = s / L[j][j];
      }
    }
    return L;
  }
  function solveSPD(A, b) {
    const L = cholesky(A);
    if (!L) return null;
    const n = A.length, y = new Float64Array(n), x = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  }
  /** Inverse by Gauss–Jordan with partial pivoting (null when singular). */
  function inverse(A) {
    const n = A.length;
    const M = A.map((r, i) => { const row = new Float64Array(2 * n); for (let j = 0; j < n; j++) row[j] = r[j]; row[n + i] = 1; return row; });
    let scale = 0; A.forEach(r => r.forEach(v => { scale = Math.max(scale, Math.abs(v)); }));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) <= 1e-13 * (scale || 1)) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c];
      for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map(r => Array.from(r.slice(n)));
  }
  function inverseSPD(A) { return inverse(A); }

  /**
   * Least squares by Householder QR with column pivoting: beta for min ||y − Xb||² (weighted
   * by w if given). Returns {beta, rank, rss, fitted, cov: (XᵀWX)⁻¹ (unscaled), pivot}.
   * Rank-deficient columns get beta = NaN.
   */
  function lstsq(X, y, w) {
    const n = X.length, p = X[0].length;
    const sw = w ? w.map(Math.sqrt) : null;
    const A = X.map((r, i) => Float64Array.from(r, v => sw ? v * sw[i] : v));
    const b = Float64Array.from(y, (v, i) => sw ? v * sw[i] : v);
    const piv = PM.range(p);
    const norms = PM.range(p).map(j => { let s = 0; for (let i = 0; i < n; i++) s += A[i][j] * A[i][j]; return s; });
    const tol = 1e-10 * Math.sqrt(Math.max(...norms, 0));
    let rank = 0;
    const Rd = new Float64Array(p);
    for (let k = 0; k < Math.min(n, p); k++) {
      // pivot the column with the largest remaining norm
      let best = k, bn = -1;
      for (let j = k; j < p; j++) { let s = 0; for (let i = k; i < n; i++) s += A[i][j] * A[i][j]; if (s > bn) { bn = s; best = j; } }
      if (Math.sqrt(bn) <= tol) break;
      if (best !== k) { for (let i = 0; i < n; i++) { const t = A[i][k]; A[i][k] = A[i][best]; A[i][best] = t; } [piv[k], piv[best]] = [piv[best], piv[k]]; }
      let alpha = Math.sqrt(bn);
      if (A[k][k] > 0) alpha = -alpha;
      const v = new Float64Array(n);
      v[k] = A[k][k] - alpha;
      for (let i = k + 1; i < n; i++) v[i] = A[i][k];
      let vn = 0; for (let i = k; i < n; i++) vn += v[i] * v[i];
      if (vn > 0) {
        for (let j = k; j < p; j++) {
          let s = 0; for (let i = k; i < n; i++) s += v[i] * A[i][j];
          const f = 2 * s / vn;
          for (let i = k; i < n; i++) A[i][j] -= f * v[i];
        }
        let s = 0; for (let i = k; i < n; i++) s += v[i] * b[i];
        const f = 2 * s / vn;
        for (let i = k; i < n; i++) b[i] -= f * v[i];
      }
      Rd[k] = A[k][k];
      rank++;
    }
    // back-substitute R[0:rank,0:rank] z = (Qᵀb)[0:rank]
    const z = new Float64Array(p).fill(NaN);
    for (let i = rank - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < rank; j++) s -= A[i][j] * z[j];
      z[i] = s / A[i][i];
    }
    const beta = new Array(p).fill(NaN);
    for (let k = 0; k < rank; k++) beta[piv[k]] = z[k];
    let rss = 0;
    for (let i = rank; i < n; i++) rss += b[i] * b[i];
    // (RᵀR)⁻¹ for the estimable block, mapped back through the pivot
    const Rinv = zeros(rank, rank);
    for (let i = rank - 1; i >= 0; i--) {
      Rinv[i][i] = 1 / A[i][i];
      for (let j = i + 1; j < rank; j++) { let s = 0; for (let k = i + 1; k <= j; k++) s += A[i][k] * Rinv[k][j]; Rinv[i][j] = -s / A[i][i]; }
    }
    const cov = zeros(p, p);
    for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) cov[a][c] = NaN;
    for (let a = 0; a < rank; a++) for (let c = 0; c < rank; c++) {
      let s = 0; for (let k = Math.max(a, c); k < rank; k++) s += Rinv[a][k] * Rinv[c][k];
      cov[piv[a]][piv[c]] = s;
    }
    const fitted = X.map(r => { let s = 0; for (let j = 0; j < p; j++) if (Number.isFinite(beta[j])) s += r[j] * beta[j]; return s; });
    return { beta, rank, rss, fitted, cov, pivot: piv };
  }

  /** Symmetric eigen-decomposition (cyclic Jacobi): values descending, vectors as columns. */
  function eigSym(Ain) {
    const n = Ain.length;
    const A = Ain.map(r => Float64Array.from(r));
    const V = eye(n);
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-30) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
    const order = PM.range(n).sort((i, j) => A[j][j] - A[i][i]);
    return { values: order.map(i => A[i][i]), vectors: V.map(row => order.map(i => row[i])) };
  }

  PM.linalg = { zeros, eye, transpose, mul, mulVec, dot, normalEq, cholesky, solveSPD, inverse, inverseSPD, lstsq, eigSym };
})(PM);
