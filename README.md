# Vehicle History Tracking System (VHTS)

블록체인 기반 차량 생애주기 이력 관리 시스템 — 중고차 시장의 오도미터 조작과 사고 이력 은폐 문제를 스마트 컨트랙트의 자동 검증으로 해결합니다.

**IFB452 Blockchain Technology — Final Project, 2026 Semester 1**
**Group [번호]**

## 팀

| 이름 | 학번 |
|---|---|
| Inkwang Lee | n11789077 |
| [팀원 이름] | [학번] |

## 핵심 가치 제안

호주 중고차 시장에서는 매년 다음 문제가 반복됩니다:
- 오도미터 조작 (주행거리 되돌림)
- 사고 이력 은폐
- 정기 검사 누락 차량 거래

VHTS는 이 모든 사건을 **6개 stakeholder가 4개 스마트 컨트랙트에 시점별로 기록**하고, 소유권 이전 시 **cross-contract 호출로 자동 검증**합니다.

## 시스템 아키텍처

![Architecture](docs/architecture.png)

> 4개 스마트 컨트랙트가 단일 신뢰 기관 없이 협력하여 차량의 전체 이력을 검증합니다. 핵심은 `VehicleRegistry.transferOwnership()`이 `MaintenanceLog`와 `InspectionRecord`를 직접 호출하여 두 가지 사기 시나리오(오도미터 조작 + 무검사 차량)를 동시에 차단하는 구조입니다.

## 스마트 컨트랙트 4개

| 컨트랙트 | 역할 | Write 권한 | 핵심 함수 |
|---|---|---|---|
| **VehicleRegistry** | 차량 등록, 역할 관리, 소유권 이전 (cross-contract 검증 포함) | Manufacturer, Owner | `registerVehicle`, `transferOwnership`, `assignRole` |
| **MaintenanceLog** | 정비 이력 + 오도미터 단조증가 검증 | ServiceCentre | `addServiceRecord`, `verifyOdometerConsistent` |
| **AccidentReport** | 사고 + 보험 청구 + 최고 심각도 추적 | Insurer | `reportAccident`, `addInsuranceClaim` |
| **InspectionRecord** | 정부 차검 + 유효기간 자동 만료 | Government | `addInspection`, `hasValidInspection` |

## 6명의 Stakeholder

| Stakeholder | 비즈니스 역할 | 컨트랙트 권한 |
|---|---|---|
| Manufacturer | 신차 출고/등록 | VehicleRegistry write |
| ServiceCentre | 정비 기록 | MaintenanceLog write |
| Insurer | 사고/청구 기록 | AccidentReport write |
| Government | 차검 기록, 규제 감시 | InspectionRecord write, 모든 컨트랙트 read |
| Owner | 소유권 이전 시작 | 자기 차량 transferOwnership |
| Buyer | 구매 전 이력 조회 | 모든 컨트랙트 read-only |

## Cross-Contract Interaction (핵심 차별점)

```
Owner.transferOwnership(VIN, buyer, 16000) called on VehicleRegistry
   │
   ├──► IMaintenanceLog.verifyOdometerConsistent(VIN, 16000)
   │       └─► returns false if 16000 < latestMileage  →  REVERT
   │
   ├──► IInspectionRecord.hasValidInspection(VIN)
   │       └─► returns false if no Pass OR expired     →  REVERT
   │
   └──► All checks pass → Update owner, emit OwnershipTransferred
```

이 구조는 **단일 트랜잭션 안에서 두 개의 다른 컨트랙트를 호출**하여 무결성을 강제합니다. 이것이 평가 기준의 *"Direct interaction between smart contracts is viewed favorably"* 항목을 충족하는 부분입니다.

## 기술 스택

- **Solidity** `^0.8.20`
- **Hardhat** `3.4.3` (재현 가능한 빌드 + 자동 테스트)
- **자동화 테스트**: 4개 테스트 컨트랙트, 20+ 테스트 함수
- **배포 자동화**: `scripts/deploy.js`로 4개 컨트랙트 + linkage + role 부여를 한 번에

## 프로젝트 구조

```
vhts-blockchain/
├── contracts/
│   ├── VehicleRegistry.sol       # 핵심 컨트랙트 (cross-contract calls)
│   ├── MaintenanceLog.sol        # 정비 이력
│   ├── AccidentReport.sol        # 사고 + 보험
│   └── InspectionRecord.sol      # 정부 검사
├── test/
│   ├── MaintenanceLog.t.sol      # 정비 로직 단위 테스트
│   ├── AccidentReport.t.sol      # 사고 로직 단위 테스트
│   ├── InspectionRecord.t.sol    # 검사 로직 단위 테스트
│   └── Integration.t.sol         # 4개 컨트랙트 통합 시나리오
├── scripts/
│   ├── deploy.js                 # 4개 컨트랙트 자동 배포 + 역할 부여
│   └── demo-scenario.js          # 라이브 데모용 시나리오 자동 실행
├── docs/
│   ├── architecture.png          # 시스템 아키텍처
│   ├── bpmn-collaboration.png    # BPMN 협업 뷰
│   └── bpmn-orchestration-*.png  # 각 stakeholder별 프로세스
├── hardhat.config.js
├── package.json
└── README.md
```

## 시작하기

### 사전 요구사항
- Node.js ≥ 20
- npm 또는 yarn

### 설치 & 컴파일 & 테스트

```shell
# 의존성 설치
npm install

# 모든 컨트랙트 컴파일
npm run compile

# 자동화 테스트 실행 (Solidity 기반)
npm test
```

### 로컬 배포 (Hardhat 내장 네트워크)

```shell
# 4개 컨트랙트 배포 + 역할 부여를 한 번에
npx hardhat run scripts/deploy.js
```

출력의 컨트랙트 주소 4개를 `scripts/demo-scenario.js`의 상수에 붙여넣은 뒤:

```shell
# 등록 → 정비 → 사고 → 검사 → 사기 시도 → 정상 이전까지 자동 시연
npx hardhat run scripts/demo-scenario.js
```

## 데모 시나리오

`scripts/demo-scenario.js` 또는 `Integration.t.sol::test_FullVehicleLifecycle`이 다음 7단계를 자동 시연합니다:

1. **등록** — Manufacturer가 Tesla Model 3 (VIN: `VIN_DEMO_2026`) 등록, 초기 소유자는 Owner1
2. **정비** — ServiceCentre가 500km, 15,000km 두 번 정비 기록
3. **사고** — Insurer가 Moderate 사고 보고 (\$3,500 수리비), \$3,000 보험금 승인
4. **검사** — Government가 차검 PASS 기록 (1년 유효)
5. **사기 시도** — Owner가 10,000km로 Buyer에게 판매 시도 → **REVERT** ("Declared mileage is lower than latest maintenance mileage")
6. **정상 이전** — Owner가 16,000km로 재시도 → **성공**
7. **조회** — Buyer가 정비/사고/검사 이력을 모두 read-only로 확인

## 배포 주소 (Sepolia Testnet)

> 최종 데모 직전 Sepolia 배포 후 갱신

| Contract | Address |
|---|---|
| VehicleRegistry | `0x...` |
| MaintenanceLog | `0x...` |
| AccidentReport | `0x...` |
| InspectionRecord | `0x...` |

## 비즈니스 프로세스 (BPMN)

- [Collaboration view (전체 stakeholder 간 메시지 흐름)](docs/bpmn-collaboration.png)
- [Orchestration views (개별 stakeholder 프로세스)](docs/)

각 BPMN은 스마트 컨트랙트 실행 **전·중·후**의 비즈니스 활동을 모두 포함합니다 (과제 요구사항 3.b).

## 설계 선택 근거

### 왜 4개로 분리했나
- **Separation of concerns**: 각 도메인(등록/정비/사고/검사)의 stakeholder와 로직이 독립적
- **모듈러 업그레이드**: 한 컨트랙트만 수정해도 나머지에 영향 없음
- **가스 최적화**: 사용하지 않는 도메인의 코드는 호출 비용에 포함되지 않음

### 왜 Solidity/Ethereum인가
- 과제 요구사항 (Solidity for Ethereum smart contracts)
- 성숙한 도구 생태계 (Hardhat, ethers.js, Etherscan)
- 광범위한 검증 가능성 (모든 트랜잭션이 공개 블록 익스플로러에서 확인 가능)

### `latestMileage` 매핑은 왜 별도로 두었나
주행거리 검증마다 정비 이력 배열을 끝까지 읽으면 O(n) 가스 비용. 별도 매핑으로 O(1) 조회 — 차량 보유 기간이 길수록 누적 효과 큼.

## 한계 및 향후 과제

| 한계 | 대응 / 한계 인정 |
|---|---|
| **Oracle problem** | 입력 데이터의 정확성은 검증 불가. 다중 출처 cross-reference, 통계적 이상치 플래그로 부분 대응. 완전한 해결은 신뢰할 수 있는 데이터 소스 필요. |
| **개인정보 / GDPR** | 온체인에는 주소 + 해시만 기록. 실제 PII는 IPFS에 암호화 저장하는 패턴 가정. "Right to erasure"와의 근본적 충돌은 한계로 인정. |
| **가스비** | 현재 Sepolia 기준 등록 ~150k gas. 대규모 운영 시 Layer 2 (Polygon, Arbitrum) 마이그레이션 권장. View 함수는 gas-free. |
| **Adoption (chicken-and-egg)** | 정부 또는 대형 보험사를 anchor stakeholder로 시작하는 단계적 도입 전략 필요 |
| **연결 lock 부재** | `linkMaintenanceContract`/`linkInspectionContract`는 admin이 재호출 가능. 운영 환경에서는 한 번 설정 후 동결하는 패턴 고려. |

## 자동화 테스트 결과

```
test/MaintenanceLog.t.sol      — 7 tests
test/AccidentReport.t.sol      — 6 tests
test/InspectionRecord.t.sol    — 7 tests
test/Integration.t.sol         — 2 end-to-end scenarios
```

테스트는 Happy path와 Negative path (revert 케이스)를 모두 커버합니다.

## 참고 문헌

- Wüst, K., & Gervais, A. (2018). Do you need a blockchain? *CVCBT*.
- Androulaki, E. et al. (2018). Hyperledger Fabric: A distributed operating system for permissioned blockchains. *EuroSys*.
- Benet, J. (2014). IPFS - Content addressed, versioned, P2P file system. *arXiv:1407.3561*.

## 라이선스

MIT
