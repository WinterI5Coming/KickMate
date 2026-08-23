/**
 * 팀 전술이 규칙 수치를 어떻게 바꾸는지 정의하는 순수 모듈.
 *
 * 전술은 경기 시작 시 팀마다 하나를 선택하며, 패스 거리·영향권 인터셉트 확률·추가
 * 이동 같은 파생 규칙만 바꾼다. 상태 전이의 뼈대(행동 경제, 스틸, 슛 관문)는 그대로다.
 * 모든 수치는 [실험 중]이며 플레이 결과로 조정한다.
 */

import type { Piece, Team, TeamStyle } from "./types";

/** 한 전술이 바꾸는 규칙 수치 묶음. */
export interface TacticProfile {
  /** 일반 패스의 최대 체비쇼프 거리. */
  passMax: number;
  /** 공격 방향으로 전진하는 패스에만 적용되는 확장 거리. 없으면 passMax를 쓴다. */
  forwardPassMax?: number;
  /** 이 팀이 패스할 때 상대 영향권 인터셉트 확률에 더하는 보정. */
  passZoneDeltaAsPasser: number;
  /** 상대가 패스할 때 이 팀의 영향권 인터셉트 확률에 더하는 보정. */
  passZoneDeltaAsDefender: number;
  /** 공이 없는 FW가 공격 방향으로 2칸 대시할 수 있는지 여부. */
  forwardDash: boolean;
  /** 상대 공 소유자에게 가까워지는 방향으로 필드 선수가 2칸 대시할 수 있는지 여부. */
  pressDash: boolean;
  /** MF의 패스가 선수별 행동 상한에 세지 않는지 여부. */
  midfielderFreePass: boolean;
}

/** 영향권 인터셉트의 기준 확률. 슛에는 전술 보정 없이 이 값을 그대로 쓴다. */
export const BASE_ZONE_INTERCEPT = 0.2;

/** 전술별 규칙 수치. balanced는 현행 기본 규칙과 완전히 같다. */
export const TACTICS: Record<TeamStyle, TacticProfile> = {
  balanced: {
    passMax: 6,
    passZoneDeltaAsPasser: 0,
    passZoneDeltaAsDefender: 0,
    forwardDash: false,
    pressDash: false,
    midfielderFreePass: false,
  },
  tikitaka: {
    passMax: 5,
    passZoneDeltaAsPasser: -0.08,
    passZoneDeltaAsDefender: 0,
    forwardDash: false,
    pressDash: false,
    midfielderFreePass: true,
  },
  counter: {
    passMax: 5,
    forwardPassMax: 6,
    passZoneDeltaAsPasser: 0,
    passZoneDeltaAsDefender: 0,
    forwardDash: true,
    pressDash: false,
    midfielderFreePass: false,
  },
  gegenpress: {
    passMax: 5,
    passZoneDeltaAsPasser: 0,
    passZoneDeltaAsDefender: 0.05,
    forwardDash: false,
    pressDash: true,
    midfielderFreePass: false,
  },
};

/** 패스 대상이 패서보다 공격 방향으로 앞서 있는지 판정한다. */
export function isForwardPass(passer: Piece, target: Piece): boolean {
  return passer.team === "home"
    ? target.pos.x > passer.pos.x
    : target.pos.x < passer.pos.x;
}

/** 전술과 패스 방향에 따른 이 패스의 최대 거리. */
export function passMaxBetween(style: TeamStyle, passer: Piece, target: Piece): number {
  const profile = TACTICS[style];
  if (profile.forwardPassMax !== undefined && isForwardPass(passer, target)) {
    return profile.forwardPassMax;
  }
  return profile.passMax;
}

/** 패서와 수비 팀의 전술 보정을 합산한 패스 영향권 인터셉트 확률. */
export function passZoneInterceptChance(
  passerStyle: TeamStyle,
  defenderStyle: TeamStyle,
): number {
  return (
    BASE_ZONE_INTERCEPT +
    TACTICS[passerStyle].passZoneDeltaAsPasser +
    TACTICS[defenderStyle].passZoneDeltaAsDefender
  );
}

/** 팀의 공격 방향 부호. home은 +x, away는 -x로 전진한다. */
export function attackDirection(team: Team): number {
  return team === "home" ? 1 : -1;
}
