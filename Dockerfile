# ============================================================
# Multi-stage build:前端 build -> 嵌入後端 -> 打包 jar -> JRE 執行
# Render 會自動偵測這個 Dockerfile 並在雲端完成整個建置,
# 本機不需要安裝 Node / Maven。
# ============================================================

# ---------- Stage 1:build Vue 前端 ----------
FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2:build Spring Boot(前端產物嵌入 static)----------
FROM maven:3.9-eclipse-temurin-17 AS backend-build
WORKDIR /app
COPY backend/pom.xml ./
# 先抓依賴,讓程式碼改動時能吃到 Docker layer cache,加速重建
RUN mvn -q dependency:go-offline
COPY backend/src ./src
COPY --from=frontend-build /app/dist ./src/main/resources/static
RUN mvn -q clean package -DskipTests

# ---------- Stage 3:執行環境(只含 JRE,映像檔小)----------
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=backend-build /app/target/*.jar app.jar
EXPOSE 8080
# Render 免費方案 512MB RAM:限制 JVM heap 避免被 OOM kill
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
