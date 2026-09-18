# =========================================
# AgentHub Frontend 镜像（多阶段构建）
#   阶段1：Node 构建静态资源
#   阶段2：Nginx 托管 + /api 反向代理到后端
# =========================================

FROM node:22-alpine AS build

WORKDIR /app

# 先装依赖（package-lock.json 不变则此层缓存）
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
