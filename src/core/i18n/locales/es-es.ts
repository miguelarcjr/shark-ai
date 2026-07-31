import { Locale } from "../types.js";

export const esEs: Locale = {
    common: {
        loading: 'Cargando...',
        success: 'Éxito',
        error: 'Error',
        cancel: 'Cancelar',
        operationCancelled: 'Operación cancelada.'
    },
    commands: {
        config: {
            title: 'Configuración Shark AI',
            selectAction: '¿Qué desea configurar?',
            actions: {
                provider: '🤖 Proveedor LLM (StackSpot / OpenAI-compatible)',
                memory: '🧠 Memoria y Embeddings',
                general: '⚙️ Preferencias Generales (Idioma, Log, API Base)',
                agents: '🆔 Agentes StackSpot (IDs y Versiones)',
                language: 'Cambiar Idioma',
                logLevel: 'Nivel de Log',
                back: 'Volver'
            },
            selectLanguage: 'Seleccione el idioma:',
            agentMenu: {
                title: 'Configuración de Agentes',
                selectAgent: '¿Qué agente desea configurar?',
                enterId: 'Ingrese el ID del Agente StackSpot (o dejar vacío para predeterminado):',
                updated: 'ID del Agente {0} actualizado.',
                options: {
                    dev: 'Agente Desarrollador',
                    ba: 'Analista de Negocios',
                    spec: 'Agente de Especificación',
                    qa: 'Agente de QA',
                    scan: 'Agente de Escaneo',
                    back: 'Volver'
                }
            },
            languageUpdated: 'Idioma actualizado a: {0}'
        },
        login: {
            intro: 'Login StackSpot',
            alreadyLoggedIn: 'Ya has iniciado sesión',
            success: '¡Inicio de sesión exitoso!',
            error: 'Error de inicio de sesión',
            selectProvider: 'Seleccione el proveedor de IA:',
            openaiIntro: 'Configuración OpenAI Compatible',
            baseURLPrompt: 'URL Base del Endpoint',
            apiKeyPrompt: 'Clave de API (API Key)',
            modelPrompt: 'Modelo (ej: llama3, openrouter/model)',
            openaiSuccess: '¡Configuración guardada correctamente!'
        },
        scan: {
            intro: '🕵️‍♂️  Agente de Escaneo',
            scanningProject: 'Escaneando proyecto en:',
            outputTarget: 'Archivo de salida:',
            language: 'Idioma:',
            templateCreated: '✅ Plantilla creada en:',
            fileExists: '📄 El archivo ya existe, será actualizado',
            analyzing: '🕵️‍♂️  Agente de escaneo analizando (Paso {step})...',
            completed: '✨ Escaneo completado exitosamente!',
            error: 'Error al ejecutar escaneo',
            stepComplete: 'Paso completado',
            scanningDir: '📂 Escaneando carpeta: {0}',
            readingFile: '📖 Leyendo archivo: {0}',
            searching: '🔍 Buscando: {0}',
            generated: '✅ Contexto Generado: {0}',
            updated: '✅ Contexto Actualizado: {0}',
            notFound: 'Archivo no encontrado.',
            stopped: 'Agente de Escaneo se detuvo sin acciones.',
            agentAsks: '🤖 Agente de Escaneo pregunta:',
            agentInput: 'Agente necesita entrada:',
            replyPlaceholder: 'Respuesta...',
            targetRedirect: "Agente apuntó a '{0}' pero forzamos '{1}'. Redirigiendo escritura.",
            contentNotFound: 'Contenido objetivo no encontrado para reemplazo.',
            skipped: 'Omitido (Agente de Escaneo solo escribe en archivo de contexto)',
            pendingSections: 'Las siguientes secciones aún necesitan análisis: {0}.',
            allPopulated: '¡Todas las secciones parecen estar pobladas!'
        }
    }
};
