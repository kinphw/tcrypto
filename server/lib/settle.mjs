// 내기 자동 정산: 결과가 나고 유예 시간(기본 1시간, 그 사이 관리자가 결과를 바로잡을 수 있음)이 지나면
// 받을 돈이 있는 사람마다 claimFor 를 대신 실행한다. 취소된 내기는 유예 없이 바로 환불.
import { settings } from './db.mjs';
import { chainNow } from './indexer.mjs';
import { enqueue } from './queue.mjs';
import { allBets, payoutOf } from './views.mjs';

export function settleTick() {
  const grace = settings().settleGraceMinutes * 60;
  let n = 0;
  for (const b of allBets()) {
    if (b.state === 'resolved' && chainNow() < b.resolvedAt + grace) continue;
    if (b.state !== 'resolved' && b.state !== 'cancelled') continue;
    for (const who of Object.keys(b.stakes)) {
      if (b.claimed[who] != null || payoutOf(b, who) <= 0) continue;
      const { duplicate } = enqueue({
        key: `claim:${b.id}:${who}`, kind: 'claim', addr: who,
        label: b.state === 'cancelled' ? `내기 #${b.id} 환불` : `내기 #${b.id} 정산`, target: 'Bets', method: 'claimFor', args: [b.id, who],
      });
      if (!duplicate) n++;
    }
  }
  return n;
}
