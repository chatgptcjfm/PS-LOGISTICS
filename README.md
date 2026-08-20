# webapp

Java 17, Spring Boot, MariaDB 기반 웹 프로젝트의 로컬 샌드박스입니다.

## 현재 구성

- Java: Eclipse Temurin 17.0.20 (사용자 영역 설치)
- Spring Boot: 3.4.5
- Build: Maven 3.9.9
- Database: MariaDB 11.8 (샌드박스 시스템 서비스)
- 기본 포트: 애플리케이션 `8080`, MariaDB `3306`
- 배포: 아직 진행하지 않음

## 현재 기능

- Spring Boot 애플리케이션 기동
- MariaDB JDBC 연결 설정
- `/api/hello` 기본 API
- `/api/db-check` MariaDB 연결 확인 API
- `/actuator/health` 애플리케이션 및 DB 상태 확인
- 업로드된 `재고 및 입고량 파악.xlsx`의 `26년 09시 WMS 재고` 시트 기반 1차 대시보드
- 전체 기간 및 월별 조회 필터
- 2026년 전체 실적·예상재고 트렌드 그래프
- 재고 트렌드 내부 탭에서 재고량 변화와 날짜별 입출고량 전환
- 적정/MAX CAPA 대비 비율을 퍼센트로 표시
- 입고·출고량, 최근 7일 현황
- 현재 시간 실시간 표시 및 기준 날짜 선택/오늘 이동 기능
- 최근 운영 현황에서 입고량·출고량 수기 수정, 저장 및 초기화
- 2026년 8월 13일까지 실적(actual), 8월 14일부터 예상(forecast) 구분
- 웹 화면에서 `.xlsx` 업로드 가능하며, 업로드 파일의 첫 번째 WMS 시트만 파싱
- 날짜형 WMS 파일의 현재고·입고·출고·CAPA 집계
- 품목형 WMS 파일의 `총중량`(KG) 기반 현재고 집계 및 KG ÷ 1,000 TON 환산
- 품목형 WMS 업로드 시 업로드 시각을 현재고 기준 시각으로 기록
- 품목형 업로드는 기존 연간 날짜별 재고 변동을 유지하면서 해당 날짜의 스냅샷만 갱신
- 품목코드 첫 글자 기준 `F=시트`, `H=원지`, `S=상품` 분류
- 품목코드 5번째 문자 기준 `1=내수`, `2=수출` 분류
- 상품(S) 품목 중 시장 코드가 다른 8건은 업무 규칙에 따라 내수로 집계
- 적정 CAPA `10,700 TON`, MAX CAPA `12,000 TON` 고정 기준
- 품목형 WMS 업로드 결과의 유형별·시장별·유형×시장 요약 차트와 미분류 코드 안내
- 재고량 표시는 소수점 없이 TON 정수로 표시
- 대용량 품목형 `.xlsx`는 Apache POI SAX 스트리밍 방식으로 처리
- Spring Boot 컨텍스트 테스트
- Excel 업로드 결과를 MariaDB `inventory_upload_history` 테이블에 영구 저장
- 대시보드 재접속·PM2 재시작 후에도 저장된 업로드 이력 자동 복원
- 여러 업로드를 시간순으로 누적 병합하며, 동일 날짜는 최신 snapshot을 적용

## 대시보드 URI

- `http://localhost:8080/` — 재고 운영 대시보드
- `/data/inventory-dashboard.json` — 대시보드용 정적 연간 baseline 데이터
- `POST /api/inventory/upload` — multipart/form-data의 `file` 필드로 `.xlsx` 업로드 및 MariaDB 저장
- `GET /api/inventory/history` — 저장된 Excel 업로드 이력과 원본 payload 조회
- 데이터 기준 시트: 업로드 파일의 첫 번째 시트(`26년 09시 WMS 재고`)
- 기준일: `2026-08-13` (이 날짜까지 실적, `2026-08-14`부터 예상)
- 단위: TON

기본 화면은 변환된 정적 JSON으로 빠르게 표시하고, Excel 업로드 시 Apache POI로 첫 번째 시트를 요청 단위로 파싱해 현재 화면에 반영합니다. 기준 날짜를 선택하면 해당 날짜까지의 데이터로 KPI·차트를 계산하며, 날짜별 입고/출고 수기 변경은 현재 브라우저의 localStorage에 저장됩니다. 현재 업로드 및 수기 변경 결과는 MariaDB에 저장하지 않으며, 이후 사용자별 업로드 이력·MariaDB 적재·공유 저장 API로 확장할 수 있습니다.

## 실행 방법

```bash
cd /home/user/webapp
export JAVA_HOME=/home/user/.jdks/jdk-17.0.20+8
export PATH="$JAVA_HOME/bin:$PATH"
sudo systemctl start mariadb
mvn spring-boot:run
```

실행 후 다음 주소를 확인합니다.

- http://localhost:8080/api/hello
- http://localhost:8080/api/db-check
- http://localhost:8080/actuator/health

## 데이터베이스 설정

기본 연결 정보는 `src/main/resources/application.yml`에 정의되어 있습니다.

- Database: `webapp`
- Username: `webapp`
- Password: `webapp`

환경 변수로 재정의할 수 있습니다.

```bash
DB_URL=jdbc:mariadb://127.0.0.1:3306/webapp \
DB_USERNAME=webapp \
DB_PASSWORD=webapp \
mvn spring-boot:run
```

## 테스트 및 패키징

```bash
export JAVA_HOME=/home/user/.jdks/jdk-17.0.20+8
mvn test
mvn clean package
java -jar target/webapp-0.0.1-SNAPSHOT.jar
```

## 다음 단계

- 수기 변경 및 업로드 결과의 MariaDB 적재/사용자별 공유
- 날짜/창고/품목별 세부 필터
- 도메인 모델 및 JPA 엔티티 추가
- Flyway 또는 Liquibase 마이그레이션 도입
- 인증/인가 구성
- API 문서화 및 통합 테스트 추가
- 별도 배포 환경과 운영용 시크릿 설정
