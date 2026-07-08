# Regras de negócio

## 1. Multi-negócio

O sistema aceita vários negócios separados. Cada lançamento operacional recebe `businessId`.

Exemplos de negócios possíveis:

- Essências aromáticas;
- Marmitas;
- Revenda;
- Consignado;
- Serviços com materiais.

Um produto de um negócio não deve aparecer nos lançamentos de outro negócio.

---

## 2. Produtos

Tipos de produto:

| Tipo | Uso |
|---|---|
| `materia_prima` | Insumos usados para produzir algo |
| `embalagem` | Vidro, rótulo, caixa, lacre, sacola, pote |
| `produto_final` | Produto fabricado internamente |
| `mercadoria` | Produto comprado pronto para revenda/consignado |
| `kit` | Composição de vários itens |
| `servico` | Venda sem estoque físico |

Produtos do tipo `servico` não devem movimentar estoque.

---

## 3. Estoque

O estoque físico é controlado por `currentStock` no produto, mas toda alteração precisa gerar histórico em `stockMovements`.

Operações que alteram estoque:

- compra;
- produção;
- venda;
- envio consignado;
- devolução consignada;
- ajuste manual futuro.

---

## 4. Custo médio

O MVP usa custo médio ponderado.

Não usar FIFO nem LIFO nesta fase.

---

## 5. Ficha técnica

A ficha técnica define quanto cada produto final consome por unidade.

Exemplo para essência:

| Item | Qtd. por unidade |
|---|---:|
| Fragrância | 20 ml |
| Base | 80 ml |
| Vidro | 1 un |
| Tampa | 1 un |
| Rótulo | 1 un |
| Caixa | 1 un |

O sistema não converte unidade automaticamente. Se o produto foi cadastrado em ml, lance em ml. Se foi cadastrado em kg, lance em kg.

---

## 6. Cálculo de custo do produto

O custo de produto final é calculado assim:

```txt
custo_materiais = soma(qtd_por_unidade * custo_medio_item)
base = custo_materiais + mao_de_obra_por_unidade + custo_fixo_rateado_por_unidade
perda = base * perda_percentual
custo_final_unidade = base + perda
```

---

## 7. Preço sugerido

O preço sugerido considera margem desejada e taxa percentual.

```txt
preco_sugerido = custo_final_unidade / (1 - margem_desejada - taxa_percentual)
```

Se margem + taxa for igual ou maior que 98%, o sistema não deve calcular preço válido.

---

## 8. Produção

Produção deve:

1. validar ficha técnica;
2. validar estoque disponível dos insumos;
3. baixar insumos;
4. registrar movimentos de saída;
5. calcular custo total;
6. dar entrada no produto final;
7. atualizar custo médio do produto final;
8. registrar movimento de entrada.

---

## 9. Venda

Venda deve:

1. validar estoque, exceto serviços;
2. calcular receita bruta;
3. descontar taxas e descontos;
4. calcular CMV;
5. baixar estoque;
6. registrar venda;
7. registrar movimento de saída.

---

## 10. Consignado

Envio consignado baixa estoque central, mas não gera receita ainda.

Eventos:

- envio;
- venda informada pelo cliente;
- devolução;
- pagamento.

Venda informada pelo cliente gera venda com canal `Consignado`, mas não baixa estoque novamente.

---

## 11. Pedidos

Pedido é controle operacional. Ele não altera estoque automaticamente até virar venda.

Tanto a aba Vendas quanto a aba Pedidos permitem montar um carrinho com vários produtos de uma vez (ver `src/salesCart.js`). No carrinho, o vendedor escolhe, por item:

- **origem do estoque**: estoque próprio do vendedor ou estoque do administrador (vira pedido aguardando aprovação);
- **canal** da venda (WhatsApp, Instagram, loja, etc.);
- **tipo de venda**: à vista, parcial ou consignado;
- **nome do cliente** (opcional).

Ao retirar/criar um pedido, o status logístico (`status`) **sempre começa `pendente`**, não importa quem cria (admin ou vendedor) — o banco força isso em um trigger, não é só validação de tela. Depois de criado, **somente o administrador** pode:

- mudar o status do pedido (arrastar no Kanban ou usar "Mover para");
- clicar em "Baixar venda" (o que despacha o pedido e lança a venda);
- excluir um pedido.

O vendedor só cria e acompanha os próprios pedidos; a mudança de status e a baixa ficam bloqueadas na interface e também no banco (trigger `enforce_order_approval_lock`).

---

## 11.1. Acerto de estoque próprio do vendedor

Vendedores antigos podem ter estoque próprio (consignado/mochila) sem registro correto no sistema. Para corrigir isso sem abrir mão do controle:

1. O administrador clica em "Liberar 1 acerto de estoque" para um vendedor específico (aba Vendas/Pedidos, painel "Permissões dos vendedores"). Isso grava 1 crédito em `seller_settings.stock_adjustment_credits`.
2. Enquanto tiver crédito, o vendedor vê a seção "Acerto de estoque" na aba **Meu estoque**: escolhe o produto, informa a quantidade correta e o motivo (obrigatório).
3. O sistema corrige `seller_stock` para a quantidade informada, grava a correção em `seller_stock_adjustments` (auditoria: quantidade anterior, nova, motivo, data) e **zera o crédito**.
4. Se o vendedor precisar corrigir de novo, o administrador precisa liberar outro crédito.

---

## 12. Tarefas

Tarefas são operacionais e não alteram estoque, vendas ou financeiro.

Servem para organizar compras, cobrança, produção, despachos e revisão.
