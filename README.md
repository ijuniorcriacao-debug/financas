# Finanças da Casa

App web (PWA, sem dependências e sem servidor) para um casal organizar as finanças:
lançar despesas fixas, variáveis e esporádicas, ver para onde o dinheiro vai, dividir
as contas **proporcionalmente à renda** de cada um e planejar quanto guardar.

## Como usar
Abra `index.html` (ou publique no GitHub Pages / qualquer hospedagem estática).
Na primeira abertura informe os nomes e as rendas. Os dados ficam no navegador
(`localStorage`); use **Ajustes → Exportar/Importar backup** para levar de um celular a outro.

## Funcionalidades
- **Resumo**: sobra do mês, renda comprometida, gastos por tipo e categoria, dicas de onde apertar, histórico de 6 meses.
- **Telas separadas**: Casa, e uma tela para cada pessoa com seus gastos pessoais (academia etc.), que não entram nas contas da casa. Cada gasto pessoal pode ser "só meu" (🔒) ou visível ao parceiro.
- **Lançamentos**: despesas/receitas extras, parcelamento, contas fixas geradas todo mês (marcar como pago), busca e filtros.
- **Divisão justa**: proporção pela renda, quanto cada um deve pagar/transferir, conta conjunta, registro de acertos.
- **Plano**: meta de poupança (% da renda de cada um), teto de gastos, orçamento por categoria.
- **Ajustes**: rendas, contas fixas, categorias, backup JSON e exportação CSV.
