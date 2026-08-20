package com.example.webapp;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class InventoryHistoryService {
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public InventoryHistoryService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void initialize() {
        jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS inventory_upload_history (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    original_filename VARCHAR(255) NOT NULL,
                    mode VARCHAR(64) NOT NULL,
                    sheet_name VARCHAR(255),
                    uploaded_at DATETIME(6) NOT NULL,
                    as_of_date DATE,
                    total_weight_kg DECIMAL(20,3),
                    total_weight_ton DECIMAL(20,3),
                    payload_json LONGTEXT NOT NULL,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    INDEX idx_inventory_upload_history_uploaded_at (uploaded_at),
                    INDEX idx_inventory_upload_history_as_of_date (as_of_date)
                )
                """);
    }

    public void save(String originalFilename, Map<String, Object> payload) {
        String payloadJson;
        try {
            payloadJson = objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("업로드 결과를 저장할 JSON으로 변환하지 못했습니다.", exception);
        }

        Map<String, Object> summary = asMap(payload.get("inventorySummary"));
        jdbcTemplate.update("""
                INSERT INTO inventory_upload_history
                    (original_filename, mode, sheet_name, uploaded_at, as_of_date,
                     total_weight_kg, total_weight_ton, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                trimFilename(originalFilename),
                stringValue(payload.get("mode"), "unknown"),
                stringValue(payload.get("sheetName"), null),
                toLocalDateTime(payload.get("uploadedAt"), payload.get("updatedAt")),
                toLocalDate(payload.get("asOfDate")),
                numberValue(summary.get("totalWeightKg")),
                numberValue(summary.get("totalWeight")),
                payloadJson
        );
    }

    public List<Map<String, Object>> findAll() {
        return jdbcTemplate.query("""
                SELECT id, original_filename, mode, sheet_name, uploaded_at,
                       as_of_date, total_weight_kg, total_weight_ton, payload_json
                FROM inventory_upload_history
                ORDER BY uploaded_at ASC, id ASC
                """, (resultSet, rowNumber) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", resultSet.getLong("id"));
            item.put("originalFilename", resultSet.getString("original_filename"));
            item.put("mode", resultSet.getString("mode"));
            item.put("sheetName", resultSet.getString("sheet_name"));
            item.put("uploadedAt", resultSet.getTimestamp("uploaded_at").toLocalDateTime().toString());
            item.put("asOfDate", resultSet.getDate("as_of_date") == null ? null : resultSet.getDate("as_of_date").toLocalDate().toString());
            item.put("totalWeightKg", resultSet.getBigDecimal("total_weight_kg"));
            item.put("totalWeightTon", resultSet.getBigDecimal("total_weight_ton"));
            try {
                item.put("payload", objectMapper.readValue(resultSet.getString("payload_json"), new TypeReference<Map<String, Object>>() {}));
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException("저장된 업로드 결과를 읽지 못했습니다. id=" + resultSet.getLong("id"), exception);
            }
            return item;
        });
    }

    private static String trimFilename(String filename) {
        if (filename == null || filename.isBlank()) {
            return "업로드 파일";
        }
        return filename.length() > 255 ? filename.substring(0, 255) : filename;
    }

    private static String stringValue(Object value, String fallback) {
        return value == null || String.valueOf(value).isBlank() ? fallback : String.valueOf(value);
    }

    private static Number numberValue(Object value) {
        return value instanceof Number number ? number : null;
    }

    private static Map<String, Object> asMap(Object value) {
        if (value instanceof Map<?, ?> source) {
            Map<String, Object> result = new LinkedHashMap<>();
            source.forEach((key, item) -> result.put(String.valueOf(key), item));
            return result;
        }
        return Map.of();
    }

    private static LocalDateTime toLocalDateTime(Object uploadedAt, Object updatedAt) {
        String value = stringValue(uploadedAt, stringValue(updatedAt, LocalDateTime.now().toString()));
        try {
            return OffsetDateTime.parse(value).toLocalDateTime();
        } catch (Exception ignored) {
            try {
                return LocalDateTime.parse(value);
            } catch (Exception ignoredAgain) {
                return LocalDateTime.now();
            }
        }
    }

    private static LocalDate toLocalDate(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return LocalDate.parse(String.valueOf(value));
        } catch (Exception ignored) {
            return null;
        }
    }
}
