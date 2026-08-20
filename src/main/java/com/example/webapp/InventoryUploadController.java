package com.example.webapp;

import java.io.IOException;
import java.util.List;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/inventory")
public class InventoryUploadController {
    private final InventoryExcelService inventoryExcelService;
    private final InventoryHistoryService inventoryHistoryService;

    public InventoryUploadController(InventoryExcelService inventoryExcelService,
                                     InventoryHistoryService inventoryHistoryService) {
        this.inventoryExcelService = inventoryExcelService;
        this.inventoryHistoryService = inventoryHistoryService;
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> upload(@RequestParam("file") MultipartFile file) {
        try {
            Map<String, Object> payload = inventoryExcelService.parse(file);
            inventoryHistoryService.save(file.getOriginalFilename(), payload);
            return ResponseEntity.ok(payload);
        } catch (IllegalArgumentException | IOException exception) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("message", exception.getMessage() == null ? "Excel 파일을 처리하지 못했습니다." : exception.getMessage()));
        }
    }

    @GetMapping("/history")
    public ResponseEntity<List<Map<String, Object>>> history() {
        return ResponseEntity.ok(inventoryHistoryService.findAll());
    }

    @GetMapping("/manual-overrides")
    public ResponseEntity<List<Map<String, Object>>> manualOverrides() {
        return ResponseEntity.ok(inventoryHistoryService.findManualOverrides());
    }

    @PutMapping("/manual-overrides/{date}")
    public ResponseEntity<?> saveManualOverride(@PathVariable String date,
                                                @RequestBody Map<String, Object> values) {
        try {
            return ResponseEntity.ok(inventoryHistoryService.saveManualOverride(LocalDate.parse(date), values));
        } catch (DateTimeParseException exception) {
            return ResponseEntity.badRequest().body(Map.of("message", "날짜 형식은 YYYY-MM-DD여야 합니다."));
        }
    }

    @DeleteMapping("/manual-overrides")
    public ResponseEntity<Void> deleteManualOverrides() {
        inventoryHistoryService.deleteManualOverrides();
        return ResponseEntity.noContent().build();
    }
}
