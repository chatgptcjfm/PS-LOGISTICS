package com.example.webapp;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.openxml4j.opc.OPCPackage;
import org.apache.poi.xssf.eventusermodel.XSSFReader;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.util.XMLHelper;
import org.springframework.stereotype.Service;
import org.xml.sax.Attributes;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.XMLReader;
import org.xml.sax.helpers.DefaultHandler;
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

        byte[] workbookBytes = file.getBytes();
        // 대용량 WMS 품목 목록은 XSSFWorkbook으로 전체 DOM을 만들면 메모리를 과점하므로 먼저 SAX로 읽는다.
        Map<String, Object> itemPayload = parseItemWmsSheet(workbookBytes, filename);
        if (itemPayload != null) {
            return itemPayload;
        }
        try (InputStream inputStream = new ByteArrayInputStream(workbookBytes);
             Workbook workbook = new XSSFWorkbook(inputStream)) {
            if (workbook.getNumberOfSheets() == 0) {
                throw new IllegalArgumentException("Excel 파일에 시트가 없습니다.");
            }
            // 업무 규칙: 구형 WMS 날짜 집계 파일도 첫 번째 시트만 사용한다.
            return parseFirstSheet(workbook.getSheetAt(0), filename);
        }
    }

    private boolean isItemWmsSheet(Sheet sheet) {
        Row header = sheet.getRow(0);
        if (header == null) {
            return false;
        }
        boolean hasItemCode = false;
        boolean hasWeight = false;
        for (Cell cell : header) {
            String label = textAt(cell);
            hasItemCode |= "품목코드".equals(label);
            hasWeight |= "총중량".equals(label);
        }
        return hasItemCode && hasWeight;
    }

    private Map<String, Object> parseItemWmsSheet(byte[] workbookBytes, String filename) throws IOException {
        try (OPCPackage packageHandle = OPCPackage.open(new ByteArrayInputStream(workbookBytes))) {
            XSSFReader reader = new XSSFReader(packageHandle);
            XMLReader xmlReader = XMLHelper.newXMLReader();
            ItemWmsSheetHandler handler = new ItemWmsSheetHandler(filename);
            xmlReader.setContentHandler(handler);
            try (InputStream sheetStream = reader.getSheetsData().next()) {
                xmlReader.parse(new InputSource(sheetStream));
            }
            return handler.hasRequiredColumns() ? handler.toPayload() : null;
        } catch (Exception exception) {
            if (exception instanceof IOException ioException) {
                throw ioException;
            }
            throw new IOException("WMS Excel 행을 읽는 중 오류가 발생했습니다.", exception);
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

    private static class ItemWmsSheetHandler extends DefaultHandler {
        private final String filename;
        private final Map<Integer, String> values = new HashMap<>();
        private final Set<String> unknownCodes = new HashSet<>();
        private final Map<String, Double> byCategory = new LinkedHashMap<>();
        private final Map<String, Double> byMarket = new LinkedHashMap<>();
        private final Map<String, Map<String, Double>> byCategoryMarket = new LinkedHashMap<>();
        private final StringBuilder cellText = new StringBuilder();
        private Map<String, Integer> columns = new HashMap<>();
        private int currentColumn = -1;
        private int rowNumber;
        private int itemCount;
        private int invalidWeightCount;
        private boolean collectingCellText;
        private String currentCellType;
        private double totalWeight;

        private ItemWmsSheetHandler(String filename) {
            this.filename = filename;
            byCategory.put("시트", 0D);
            byCategory.put("원지", 0D);
            byCategory.put("상품", 0D);
            byMarket.put("내수", 0D);
            byMarket.put("수출", 0D);
            for (String category : byCategory.keySet()) {
                Map<String, Double> marketValues = new LinkedHashMap<>();
                marketValues.put("내수", 0D);
                marketValues.put("수출", 0D);
                byCategoryMarket.put(category, marketValues);
            }
        }

        @Override
        public void startElement(String uri, String localName, String qName, Attributes attributes) {
            if ("c".equals(qName)) {
                currentColumn = columnNumber(attributes.getValue("r"));
                currentCellType = attributes.getValue("t");
                cellText.setLength(0);
            } else if ("v".equals(qName) || "t".equals(qName)) {
                collectingCellText = true;
            }
        }

        @Override
        public void characters(char[] ch, int start, int length) {
            if (collectingCellText) {
                cellText.append(ch, start, length);
            }
        }

        @Override
        public void endElement(String uri, String localName, String qName) {
            if ("v".equals(qName) || "t".equals(qName)) {
                collectingCellText = false;
            } else if ("c".equals(qName)) {
                values.put(currentColumn, cellText.toString().trim());
                currentColumn = -1;
                currentCellType = null;
            } else if ("row".equals(qName)) {
                if (rowNumber == 0) {
                    readHeader();
                } else {
                    readItem();
                }
                values.clear();
                rowNumber++;
            }
        }

        private void readHeader() {
            for (Map.Entry<Integer, String> entry : values.entrySet()) {
                String label = entry.getValue().replace(" ", "").trim();
                if ("품목코드".equals(label)) {
                    columns.put("itemCode", entry.getKey());
                } else if ("총중량".equals(label)) {
                    columns.put("totalWeight", entry.getKey());
                }
            }
            if (!columns.containsKey("itemCode") || !columns.containsKey("totalWeight")) {
                throw new IllegalArgumentException("WMS 파일에서 품목코드 또는 총중량 컬럼을 찾지 못했습니다.");
            }
        }

        private void readItem() {
            String itemCode = values.get(columns.get("itemCode"));
            if (itemCode == null || itemCode.isBlank()) {
                return;
            }
            itemCode = itemCode.trim().toUpperCase(Locale.ROOT);
            String category = categoryOf(itemCode);
            String market = marketOf(itemCode);
            if (category == null || market == null) {
                if (unknownCodes.size() < 20) {
                    unknownCodes.add(itemCode);
                }
                return;
            }
            Double weight = parseNumber(values.get(columns.get("totalWeight")));
            if (weight == null) {
                invalidWeightCount++;
                return;
            }
            itemCount++;
            totalWeight += weight;
            byCategory.merge(category, weight, Double::sum);
            byMarket.merge(market, weight, Double::sum);
            byCategoryMarket.get(category).merge(market, weight, Double::sum);
        }

        private boolean hasRequiredColumns() {
            return columns.containsKey("itemCode") && columns.containsKey("totalWeight");
        }

        private Map<String, Object> toPayload() {
            if (itemCount == 0) {
                throw new IllegalArgumentException("품목코드 규칙(F/H/S 및 5번째 문자 1/2)에 맞는 WMS 데이터가 없습니다.");
            }
            String today = LocalDate.now().toString();
            Map<String, Object> record = new LinkedHashMap<>();
            record.put("date", today);
            record.put("dataType", "actual");
            record.put("currentStock", round(totalWeight));
            record.put("inbound", 0D);
            record.put("outbound", 0D);

            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("itemCount", itemCount);
            summary.put("invalidWeightCount", invalidWeightCount);
            summary.put("unknownCodeCount", unknownCodes.size());
            summary.put("unknownCodes", new ArrayList<>(unknownCodes));
            summary.put("totalWeight", round(totalWeight));
            summary.put("byCategory", roundedMap(byCategory));
            summary.put("byMarket", roundedMap(byMarket));
            summary.put("byCategoryMarket", roundedNestedMap(byCategoryMarket));

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("mode", "wms-item-summary");
            result.put("source", filename + " / 첫 번째 시트");
            result.put("sheetName", "sheet1");
            result.put("unit", "TON");
            result.put("asOfDate", today);
            result.put("forecastFrom", today);
            result.put("updatedAt", today);
            result.put("classificationRules", Map.of("category", "F=시트, H=원지, S=상품", "market", "품목코드 5번째 문자 1=내수, 2=수출"));
            result.put("inventorySummary", summary);
            result.put("records", List.of(record));
            return result;
        }

        private static String categoryOf(String code) {
            return switch (code.charAt(0)) {
                case 'F' -> "시트";
                case 'H' -> "원지";
                case 'S' -> "상품";
                default -> null;
            };
        }

        private static String marketOf(String code) {
            if (code.length() < 5) {
                return null;
            }
            return switch (code.charAt(4)) {
                case '1' -> "내수";
                case '2' -> "수출";
                default -> null;
            };
        }

        private static Double parseNumber(String value) {
            if (value == null || value.isBlank()) {
                return null;
            }
            try {
                return Double.valueOf(value.replace(",", "").trim());
            } catch (NumberFormatException exception) {
                return null;
            }
        }

        private static int columnNumber(String reference) {
            if (reference == null || reference.isBlank()) {
                return -1;
            }
            int number = 0;
            for (int i = 0; i < reference.length() && Character.isLetter(reference.charAt(i)); i++) {
                number = number * 26 + (Character.toUpperCase(reference.charAt(i)) - 'A' + 1);
            }
            return number - 1;
        }

        private static double round(double value) {
            return BigDecimal.valueOf(value).setScale(3, RoundingMode.HALF_UP).doubleValue();
        }

        private static Map<String, Double> roundedMap(Map<String, Double> source) {
            Map<String, Double> result = new LinkedHashMap<>();
            source.forEach((key, value) -> result.put(key, round(value)));
            return result;
        }

        private static Map<String, Map<String, Double>> roundedNestedMap(Map<String, Map<String, Double>> source) {
            Map<String, Map<String, Double>> result = new LinkedHashMap<>();
            source.forEach((key, value) -> result.put(key, roundedMap(value)));
            return result;
        }
    }
}
