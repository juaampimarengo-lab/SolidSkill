/**
 * Latest-wins guard for async work: `begin()` marks a new request and returns
 * a predicate that is true only while that request is still the newest. A
 * response from a superseded request (e.g. account A after the user already
 * chose account B) checks it and drops itself.
 */
export interface LatestGate {
  begin: () => () => boolean
}

export function createLatestGate(): LatestGate {
  let current = 0
  return {
    begin: () => {
      current += 1
      const mine = current
      return () => mine === current
    }
  }
}
