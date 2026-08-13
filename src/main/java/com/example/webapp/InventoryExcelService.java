package com.example.webapp;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class InventoryExcelService {
    private static final LocalDate AS_OF_DATE = LocalDate.of(2026, 8, 13);
    private static final Pattern MONTH_PATTERN = Pattern.compile("(\\d{2})년\\s*(\\d{2})월");
    private final DataFormatter formatter = new DataFormatter();

    public Map<String, Object> parse(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("업로드된 Excel 파일이 비어 있습니다.");
        }
        String filename = file.getOriginalFilename() == null ? "업로드 파일" : file.getOriginalFilename();
        if (!filename.toLowerCase().endsWith(".xlsx")) {
            throw new IllegalArgumentException(".xlsx 파일만 업로드할 수 있습니다.");
        }

        try (InputStream inputStream = file.getInputStream(); Workbook workbook = new XSSFWorkbook(inputStream)) {
            if (workbook.getNumberOfSheets() == 0) {
                throw new IllegalArgumentException("Excel 파일에 시트가 없습니다.");
            }
            // 업무 규칙: 업로드 파일은 항상 첫 번째 시트(2026년 WMS 기준)만 사용한다.
            Sheet sheet = workbook.getSheetAt(0);
            return parseFirstSheet(sheet, filename);
        }
    }

    private Map<String, Object> parseFirstSheet(Sheet sheet, String filename) {
        Map<String, Object> result = new HashMap<>();
        List<Map<String, Object>> records = new ArrayList<>();
        Map<Integer, LocalDate> dateColumns = findDateColumns(sheet);

        int currentStockRow = findRow(sheet, "기초재고(09시 기준)");
        int targetCapaRow = findRow(sheet, "적정 CAPA 比");
        int maxCapaRow = findRow(sheet, "MAX CAPA 比");
        int domesticOutboundRow = findRow(sheet, "내수 출고");
        int exportOutboundRow = findRow(sheet, "수출 출고");
        int outboundRow = findRow(sheet, "내수+수출 출고");
        int inboundRow = findRow(sheet, "생산 입고");

        for (Map.Entry<Integer, LocalDate> entry : dateColumns.entrySet()) {
            int column = entry.getKey();
            LocalDate date = entry.getValue();
            Double currentStock = numberAt(sheet, currentStockRow, column);
            if (currentStock == null) {
                continue;
            }
            Map<String, Object> record = new HashMap<>();
            record.put("date", date.toString());
            record.put("dataType", date.isAfter(AS_OF_DATE) ? "forecast" : "actual");
            record.put("currentStock", currentStock);
            record.put("targetCapaRatio", numberAt(sheet, targetCapaRow, column));
            record.put("maxCapaRatio", numberAt(sheet, maxCapaRow, column));
            record.put("domesticOutbound", numberAt(sheet, domesticOutboundRow, column));
            record.put("exportOutbound", numberAt(sheet, exportOutboundRow, column));
            record.put("outbound", numberAt(sheet, outboundRow, column));
            record.put("inbound", numberAt(sheet, inboundRow, column));
            records.add(record);
        }

        if (records.isEmpty()) {
            throw new IllegalArgumentException("첫 번째 시트에서 WMS 재고 날짜 데이터를 찾지 못했습니다.");
        }
        result.put("source", filename + " / 첫 번째 시트: " + sheet.getSheetName());
        result.put("sheetName", sheet.getSheetName());
        result.put("unit", "TON");
        result.put("asOfDate", AS_OF_DATE.toString());
        result.put("forecastFrom", AS_OF_DATE.plusDays(1).toString());
        result.put("updatedAt", AS_OF_DATE.toString());
        result.put("records", records);
        return result;
    }

    private Map<Integer, LocalDate> findDateColumns(Sheet sheet) {
        Map<Integer, LocalDate> dates = new HashMap<>();
        YearMonth currentMonth = null;
        Row header = sheet.getRow(2);
        if (header == null) {
            return dates;
        }
        for (int column = 0; column < header.getLastCellNum(); column++) {
            String value = textAt(header.getCell(column));
            Matcher matcher = value == null ? null : MONTH_PATTERN.matcher(value);
            if (matcher != null && matcher.find()) {
                currentMonth = YearMonth.of(2000 + Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2)));
                continue;
            }
            Double day = numberAt(header, column);
            if (currentMonth != null && day != null && day >= 1 && day <= currentMonth.lengthOfMonth()) {
                dates.put(column, currentMonth.atDay(day.intValue()));
            }
        }
        return dates;
    }

    private int findRow(Sheet sheet, String label) {
        for (Row row : sheet) {
            for (Cell cell : row) {
                if (label.equals(textAt(cell))) {
                    return row.getRowNum();
                }
            }
        }
        return -1;
    }

    private Double numberAt(Sheet sheet, int rowIndex, int columnIndex) {
        if (rowIndex < 0) {
            return null;
        }
        return numberAt(sheet.getRow(rowIndex), columnIndex);
    }

    private Double numberAt(Row row, int columnIndex) {
        if (row == null) {
            return null;
        }
        Cell cell = row.getCell(columnIndex);
        if (cell == null) {
            return null;
        }
        try {
            double value = cell.getNumericCellValue();
            return BigDecimal.valueOf(value).setScale(3, RoundingMode.HALF_UP).doubleValue();
        } catch (IllegalStateException exception) {
            try {
                String text = formatter.formatCellValue(cell).replace(",", "").trim();
                return text.isEmpty() ? null : Double.valueOf(text);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
    }

    private String textAt(Cell cell) {
        if (cell == null) {
            return null;
        }
        String value = formatter.formatCellValue(cell);
        return value == null ? null : value.trim();
    }
}
