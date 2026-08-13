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
- 날짜별 현재고 추이(재고 트렌드 탭), 적정/MAX CAPA 대비, 입고·출고량, 최근 7일 현황
- 2026년 8월 13일까지 실적(actual), 8월 14일부터 예상(forecast) 구분
- 웹 화면에서 `.xlsx` 업로드 가능하며, 업로드 파일의 첫 번째 `2026년 WMS` 기준 시트만 파싱
- Spring Boot 컨텍스트 테스트

## 대시보드 URI

- `http://localhost:8080/` — 재고 운영 대시보드
- `/data/inventory-dashboard.json` — 대시보드용 변환 데이터
- `POST /api/inventory/upload` — multipart/form-data의 `file` 필드로 `.xlsx` 업로드
- 데이터 기준 시트: 업로드 파일의 첫 번째 시트(`26년 09시 WMS 재고`)
- 기준일: `2026-08-13` (이 날짜까지 실적, `2026-08-14`부터 예상)
- 단위: TON

기본 화면은 변환된 정적 JSON으로 빠르게 표시하고, Excel 업로드 시 Apache POI로 첫 번째 시트를 요청 단위로 파싱해 현재 화면에 반영합니다. 현재 업로드 결과는 MariaDB에 저장하지 않으며, 이후 업로드 이력·MariaDB 적재·실시간 API로 확장할 수 있습니다.

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

- 업로드 파일 검증 결과와 업로드 이력의 MariaDB 적재
- 날짜/창고/품목별 세부 필터
- 도메인 모델 및 JPA 엔티티 추가
- Flyway 또는 Liquibase 마이그레이션 도입
- 인증/인가 구성
- API 문서화 및 통합 테스트 추가
- 별도 배포 환경과 운영용 시크릿 설정
