# Constitución del producto Araguaney CFB

Este documento captura las **3 reglas duras** del producto que son inviolables y
están blindadas a nivel de base de datos:

1. **Maturity boundary**: ninguna cuota puede vencer después del vencimiento del
   certificado.
2. **Order indivisibility**: una orden entra completa a un certificado o no
   entra. Implementada con `UNIQUE (order_id)` en `cfb.certificate_orders`.
3. **Round-down only**: la suma de cuotas en el pool nunca puede exceder
   `nominal_target`. El gap se devuelve al inversor en cash.

> Esta es una versión placeholder. El contenido completo (definiciones formales,
> ejemplos, casos límite, racional de cada regla) se completará en un prompt
> posterior una vez que el equipo de Tesorería valide la redacción final.
