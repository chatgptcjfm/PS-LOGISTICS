package com.example.webapp;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
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

    @org.springframework.web.bind.annotation.GetMapping("/history")
    public ResponseEntity<List<Map<String, Object>>> history() {
        return ResponseEntity.ok(inventoryHistoryService.findAll());
    }
}
