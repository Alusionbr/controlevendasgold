# Controle360 — Lógica de Domínio v1

## 1. Matriz de Funções por Perfil

### Administrador

Pode ver e operar:

- Dashboard geral
- Vendas
- Clientes
- Produtos
- Estoque geral
- Fornecedores
- Compras
- Produção
- Fichas de custo
- Pedidos dos vendedores
- Aprovações
- Débitos dos vendedores
- Pagamentos recebidos dos vendedores
- Consignado de clientes
- Devoluções
- Desperdícios
- Brindes
- Relatórios
- Backup/exportação
- Configurações
- Vendedores
- Preços e pisos

### Vendedor

Deve ver apenas:

- Hoje
- Vender
- Meus clientes
- Meu estoque
- Meus pedidos
- Meu saldo com admin
- Minhas devoluções
- Consignado com clientes
- Minhas metas
- Ajuda
- Perfil/Sair

### Vendedor não deve ver

- Fornecedores
- Compras
- Produção
- Fichas de custo
- CMV interno do negócio
- Relatórios globais
- Backup/exportação
- Outros vendedores
- Preços globais
- Configurações do negócio
- Aprovações administrativas

---

## 2. Pedido de Reposição do Vendedor

Pedido de reposição é o pedido do vendedor para receber mercadoria do administrador.

Pode ser:

1. À vista
2. Consignado
3. Misto/parcial

### À vista

O vendedor paga tudo na hora.

Resultado:

- aumenta estoque do vendedor;
- baixa estoque do admin;
- não cria dívida.

### Consignado

O vendedor recebe mercadoria e fica devendo ao administrador.

Resultado:

- aumenta estoque do vendedor;
- baixa estoque do admin;
- cria débito do vendedor.

### Misto/parcial

O vendedor paga uma parte e o restante fica em aberto.

Resultado:

- aumenta estoque do vendedor;
- baixa estoque do admin;
- registra pagamento inicial;
- cria saldo devedor restante.

### Campos necessários no pedido

- `id`
- `business_id`
- `seller_id`
- `status`
- `payment_mode`: `avista`, `consignado`, `parcial`
- `requested_total`
- `approved_total`
- `paid_initial_amount`
- `debt_amount`
- `notes`
- `created_at`
- `approved_at`
- `approved_by`

### Campos necessários nos itens

- `order_id`
- `product_id`
- `requested_quantity`
- `approved_quantity`
- `unit_price`
- `requested_subtotal`
- `approved_subtotal`
- `adjustment_reason`

### Status recomendados

- `pendente`
- `aprovado`
- `aprovado_com_ajuste`
- `aprovado_parcialmente`
- `rejeitado`
- `entregue`
- `finalizado`

### Regra

Valor financeiro deve ser calculado sobre o que foi aprovado, não sobre o que foi pedido.

---

## 3. Conta Corrente do Vendedor

Todo vendedor pode ter uma conta financeira com o administrador.

A conta recebe lançamentos:

- pedido consignado aprovado;
- pedido parcial aprovado;
- pagamento fracionado;
- devolução confirmada;
- ajuste manual autorizado;
- brinde autorizado ao vendedor, se impactar dívida.

Modelo:

```text
Pedido consignado aprovado     + R$ 500
Pagamento recebido             - R$ 100
Devolução conferida            - R$ 80
Saldo atual                    = R$ 320
```

### Tipos de lançamento

- `debit_replenishment`
- `payment`
- `return_credit`
- `manual_adjustment`
- `writeoff`
- `bonus_credit`

### Regra

Nunca sobrescrever o saldo manualmente. O saldo deve ser resultado dos lançamentos.

---

## 4. Aprovação com Ajuste ou Parcial

O vendedor pode pedir produtos em quantidade maior do que o estoque disponível.

O sistema não deve travar. O administrador deve poder corrigir na aprovação.

Regra central:

```text
Quantidade solicitada ≠ quantidade aprovada
```

### Cenários

- Aprovar completo: solicitado = aprovado.
- Aprovar com ajuste: admin altera quantidades ou valores antes de aprovar.
- Aprovar parcialmente: admin aprova apenas parte dos itens.
- Rejeitar: admin rejeita o pedido.

### Efeito financeiro

O débito do vendedor deve considerar apenas quantidade aprovada.

### Tela admin

Cada item do pedido deve mostrar:

- solicitado;
- disponível;
- aprovado;
- subtotal aprovado;
- motivo do ajuste.

### Tela vendedor

Mostrar simples:

- solicitado;
- aprovado;
- diferença;
- observação do admin.

---

## 5. Devoluções, Desperdícios e Brindes

### Devolução

Serve para registrar retorno de mercadoria.

Pode ser:

- cliente devolvendo ao vendedor;
- vendedor devolvendo ao administrador;
- consignado voltando;
- reposição parcialmente retornada.

Status:

- `a_devolver`
- `enviado`
- `recebido`
- `devolvido`
- `devolvido_parcialmente`
- `recusado`

Regra:

`a_devolver` não volta para o estoque e não abate dívida final.

Só após conferência:

- volta para estoque, se reaproveitável;
- abate dívida, se aplicável.

### Desperdício

Serve para baixa por perda:

- quebra;
- vazamento;
- vencimento;
- avaria;
- erro operacional;
- perda no transporte.

Resultado:

- baixa estoque;
- não gera venda;
- pode ou não gerar responsabilidade financeira.

### Brinde

Serve para saída sem cobrança:

- amostra;
- mimo;
- bonificação;
- compensação.

Resultado:

- baixa estoque;
- não gera receita;
- precisa de responsável/autorização.

---

## 6. Dois Tipos de Consignado

### Admin → Vendedor

O vendedor pega mercadoria do administrador e fica devendo.

Deve aparecer como:

- débito do vendedor;
- estoque do vendedor;
- pagamentos fracionados;
- devoluções ao admin.

### Vendedor → Cliente

O vendedor entrega mercadoria ao cliente e acerta depois.

Deve aparecer como:

- consignado com cliente;
- quantidade enviada;
- quantidade vendida;
- quantidade devolvida;
- valor pago;
- saldo a receber.

Regra:

Esses dois fluxos não podem ficar misturados na interface.
