/** 线性同余伪随机数：让每次生成的场景完全一致 */
export function makeRng(seed = 20240613) {
  let s = seed >>> 0;
  return function rng() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const rng = makeRng();
export const rand = (a = 0, b = 1) => a + rng() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(rng() * arr.length)];
export const chance = (p) => rng() < p;
