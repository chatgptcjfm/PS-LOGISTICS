package com.example.webapp;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class ApiController implements HealthIndicator {
    private final JdbcTemplate jdbcTemplate;

    public ApiController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/hello")
    public Map<String, Object> hello() {
        return Map.of(
                "message", "Spring Boot + MariaDB sandbox is ready",
                "timestamp", OffsetDateTime.now(ZoneOffset.UTC).toString());
    }

    @GetMapping("/db-check")
    public Map<String, Object> databaseCheck() {
        Integer one = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
        return Map.of("database", "MariaDB", "result", one == null ? 0 : one);
    }

    @Override
    public Health health() {
        try {
            jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            return Health.up().withDetail("database", "MariaDB").build();
        } catch (Exception exception) {
            return Health.down(exception).build();
        }
    }
}
