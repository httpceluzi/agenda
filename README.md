# Gestor de Proyectos — Bot de Telegram

Bot personal para gestionar tareas y recibir notificaciones automáticas.

## Deploy en Railway (5 minutos)

### 1. Subir a GitHub
```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/TU_USUARIO/gestor-bot.git
git push -u origin main
```

### 2. Crear proyecto en Railway
1. Ir a https://railway.app
2. "New Project" → "Deploy from GitHub repo"
3. Seleccionar el repositorio

### 3. Variables de entorno (obligatorio)
En Railway → tu proyecto → Variables, agregar:

| Variable | Valor |
|----------|-------|
| `BOT_TOKEN` | `8957766160:AAFHrOTbpYp9mzGeq1jZoZ7gcgK24qaOftI` |
| `CHAT_ID` | `6603562807` |

### 4. Listo
El bot se inicia automáticamente y te manda un mensaje de confirmación a Telegram.

## Comandos del bot

| Comando | Descripción |
|---------|-------------|
| `/nueva título` | Crear tarea (detecta fecha, prioridad y proyecto automáticamente) |
| `/hoy` | Tareas que vencen hoy |
| `/semana` | Tareas de los próximos 7 días |
| `/lista` | Todas las tareas activas |
| `/listo id` | Marcar tarea como completada |
| `/resumen` | Estadísticas generales |
| `/ayuda` | Ver todos los comandos |

## Ejemplos de uso

```
/nueva Editar video canal YT mañana prioridad alta
/nueva Publicar ebook en Gumroad 2025-06-01
/nueva Revisar métricas Operación Silencio hoy
/listo 1779653575604
```

## Notificaciones automáticas

- **9:00 AM** todos los días — resumen de tareas del día
- **Cada hora** — alerta si hay tareas que vencen hoy
- **Lunes 8:00 AM** — plan de la semana

(Horario Argentina UTC-3)
