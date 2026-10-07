# desk-tools

업무용 잡툴 모음 (공개).

## Illustrator

| 스크립트 | 설명 |
|----------|------|
| [`illustrator/green-overlay.jsx`](illustrator/green-overlay.jsx) | 문서 계층에서 복수 오브젝트 또는 레이어 전체 범위를 선택하고 지정 레이어/그룹에 오버레이 사각형 생성 |

### 설치와 실행

1. GitHub의 **Code → Download ZIP**으로 리포지토리 전체를 받아 압축을 푼다. [main ZIP](https://github.com/Seokhyun0079/desk-tools/archive/refs/heads/main.zip)
2. `illustrator/green-overlay.jsx`와 같은 위치의 **`illustrator/green-overlay/` 폴더를 함께 유지**한다. JSX 하나만 복사하면 포함 파일을 찾을 수 없어 실행되지 않는다. 기존 설치를 갱신할 때도 진입 파일과 폴더를 같은 버전으로 함께 교체한다.
3. Adobe Illustrator에서 문서를 열고 **파일 → 스크립트 → 기타 스크립트…**에서 `illustrator/green-overlay.jsx`를 실행한다.
4. Illustrator 스크립트 폴더에 설치할 때도 `green-overlay.jsx`와 `green-overlay/` 폴더를 함께 넣는다. `.jsxinc` 파일은 직접 실행하지 않는다.

### 사용법

1. 위쪽 **作成先**에서 결과를 넣을 레이어/그룹을 펼쳐 선택한다.
2. 아래쪽 **対象オブジェクト**에서 필요한 계층을 펼친다. 기본 TreeView 화살표는 개폐만 담당한다.
3. 개별 오브젝트는 일반 클릭으로 누적 선택/해제한다. 선택 상태는 `☑` / `☐`로 표시하고 클릭한 위치로 화면 중심을 이동한다.
4. **全選択 / 全解除**, **配下を全選択 / 全解除**는 기존 개별 오브젝트 선택에 사용한다. 전체 선택은 레이어 전체 대상을 자동으로 추가하지 않고, 전체 해제는 레이어 대상도 해제한다.
5. 레이어 전체를 사각형 하나의 대상으로 삼으려면 레이어 이름 행을 선택한 뒤 목록 위 **レイヤー全体を対象にする** 버튼을 누른다. 대상인 레이어에는 `（対象）` 표시가 붙고 버튼은 **レイヤー対象を解除**로 바뀐다.
6. R/G/B와 불투명도를 지정하고 **確認 / 実行**을 누른다. 일반 오브젝트는 기존 표시 경계(`visibleBounds`, 취득 오류 시 `geometricBounds`)에 맞춰 생성한다. 레이어는 하위 요소 전체의 범위를 합친 사각형 하나를 만든다.

### 레이어 범위와 오류 처리

- 레이어 선택은 저장된 Illustrator 객체의 크기를 직접 읽지 않는다. 화면 이동과 크기 미리보기는 BridgeTalk에서 실제 문서의 레이어를 다시 찾고, 생성 직전에도 모든 선택 레이어의 범위를 새로 계산한다. 미리보기가 없어도 선택/해제와 하위 목록은 유지된다.
- 같은 실행에서 만든 사각형이 뒤의 레이어 크기에 포함되지 않도록, 레이어 범위는 모든 사각형 생성 전에 확정한다.
- 숨김이 확인된 요소·상위 레이어와 가이드는 제외한다. 표시 상태를 읽을 수 없는 요소는 읽을 수 있는 경계를 포함하고 불확실성을 알린다. 잠긴 요소의 잠금은 변경하지 않는다.
- 자식 경계를 읽지 못하더라도 그룹 자체의 경계를 읽을 수 있으면 그 범위를 대신 사용하고 생성 결과에 대체 계산을 알린다. 이 경우 숨긴 자식이나 그룹 외관 효과의 범위도 포함될 수 있다.
- 복합 패스 자체의 범위를 읽지 못하면 구성 패스의 범위로 계산한다. 클리핑은 마스크 경계 사각형과 내용 경계의 교차로 계산하며 비사각형 마스크의 픽셀 단위 측정은 아니다.
- 비어 있거나 정확한 범위를 구하지 못하는 레이어는 생성 때 해당 대상의 실패로 보고한다. 다른 선택 요소로 대체하거나 다른 정상 대상의 생성을 중단하지 않는다.
- 문서의 레이어 위치나 이름을 변경한 경우 툴을 다시 실행해 목록을 갱신한다. 실행 중 문서를 바꿔 사용하지 않는다.

### 코드 구성

| 파일 | 역할 |
|------|------|
| `green-overlay.jsx` | 실행 진입점, 공유 상태, 시작/종료 |
| `green-overlay/logging.jsxinc` | 실패 로그와 오류 표시 |
| `green-overlay/model.jsxinc` | 이름·타입·중복 제거·직접 자식 및 선택 모델 |
| `green-overlay/bounds.jsxinc` | 범위 계산, 레이어 식별, 호스트용 범위 코드 |
| `green-overlay/ui.jsxinc` | 창·설정·선택 정보 |
| `green-overlay/bridge.jsxinc` | BridgeTalk와 화면 이동 |
| `green-overlay/tree.jsxinc` | 계층 읽기·진행 표시·네이티브 트리 구성 |
| `green-overlay/execute.jsxinc` | 생성 대상 키와 호스트 생성 코드 |
| `green-overlay/actions.jsxinc` | 버튼·클릭·창 이벤트 |

포함 파일은 진입점의 같은 함수 스코프 안에서 로드한다. 전역 모듈이나 별도 엔진 상태를 만들지 않는다. `#include`는 소스 내용을 합치는 방식이므로 분할 자체를 실행 속도 개선으로 간주하지 않는다. 큰 문서의 비용은 실제 계층/경계 조회와 트리 구성에서도 발생한다.

### 시작 성능 및 실패 기록

- 창을 먼저 표시한 뒤 같은 실행 턴에서 계층을 읽고 양쪽 트리가 같은 모델을 공유한다. 일반 오브젝트의 하위 컬렉션은 조회하지 않는다. 계층 읽기는 BridgeTalk 콜백으로 옮기지 않는다.
- 기본적으로 접힌 트리를 만든다. 최대 64개 작업 또는 약 20ms마다 진행 표시를 갱신한다. 최초 계층 읽기나 개별 DOM 호출이 느리면 UI 반응이 지연될 수 있다.
- 로그는 ExtendScript `Folder.userData` 아래 `desk-tools/green-overlay.log`에 저장한다. 시작 시간, 계층/경계/화면 이동/BridgeTalk/생성 실패를 기록하며 문서명이나 오브젝트명은 넣지 않는다.
- 1MB 초과 시 직전 로그를 `green-overlay.log.1`로 보관한다.
- 진입 JSX와 포함 JSXINC 파일은 UTF-8 BOM을 유지한다.
- 동작 정본: [`illustrator/green-overlay-requirements.md`](illustrator/green-overlay-requirements.md). 실패·재발 방지 기록: [`illustrator/failure-log.md`](illustrator/failure-log.md).
- 자동 검증: `node illustrator/tests/green-overlay.test.cjs`, `node illustrator/tests/artwork-diagnostics.test.cjs`. 모의 환경 검증이며 실제 Illustrator의 결과를 대신하지 않는다.
