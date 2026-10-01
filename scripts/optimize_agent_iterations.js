/**
 * Optimize AI Agent & Groq Model Node Parameters:
 * 1. Sets maxIterations: 1 on Node 2004 (AI Agent) to avoid multi-loop token overhead & iteration exhaustion
 * 2. Swaps Groq model from restrictive gpt-oss-120b (8,000 TPM limit) to high-capacity llama-3.3-70b-versatile (100,000 TPM limit)
 * 3. Adds maxTokens: 500 cap on Groq Chat Model (Node 2005)
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'evolution_whatsapp_ai_agent_bot.json');
const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// 1. Update Node 2004 (AI Agent) maxIterations to 1
const node2004 = workflow.nodes.find(n => n.id === '2004' || n.name === 'AI Agent (Shared Engine)');
if (node2004) {
  node2004.parameters.options = {
    ...node2004.parameters.options,
    maxIterations: 1,
    returnIntermediateSteps: false
  };
  console.log('✓ Node 2004 (AI Agent): maxIterations set to 1');
}

// 2. Update Node 2005 (Groq Chat Model) model & options
const node2005 = workflow.nodes.find(n => n.id === '2005' || n.name === 'Groq Chat Model');
if (node2005) {
  node2005.parameters.model = 'llama-3.3-70b-versatile';
  node2005.parameters.options = {
    ...node2005.parameters.options,
    temperature: 0.3,
    maxTokens: 500
  };
  console.log('✓ Node 2005 (Groq Chat Model): Model updated to llama-3.3-70b-versatile (100,000 TPM capacity) with maxTokens: 500');
}

fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('✅ Successfully optimized evolution_whatsapp_ai_agent_bot.json for single-iteration execution and 100K TPM Groq capacity!');
