#include <string>
#include <vector>

#include <gtest/gtest.h>

#include "common/chat.h"
#include "utils/QwenTemplate.hpp"

using namespace qvac_lib_inference_addon_llama::utils;

class QwenTemplateTest : public ::testing::Test {};

TEST_F(QwenTemplateTest, ReturnsNonEmptyTemplate) {
  const char* template_str = getFixedQwen3Template();
  ASSERT_NE(template_str, nullptr);
  EXPECT_GT(std::string(template_str).length(), 0);
}

TEST_F(QwenTemplateTest, ContainsJinjaSyntax) {
  const char* template_str = getFixedQwen3Template();
  std::string template_string(template_str);

  EXPECT_NE(template_string.find("{%"), std::string::npos);
  EXPECT_NE(template_string.find("{{"), std::string::npos);
}

TEST_F(QwenTemplateTest, ContainsToolsHandling) {
  const char* template_str = getFixedQwen3Template();
  std::string template_string(template_str);

  EXPECT_NE(template_string.find("tools"), std::string::npos);
  EXPECT_NE(template_string.find("tool_call"), std::string::npos);
}

TEST_F(QwenTemplateTest, ConsistentAcrossCalls) {
  const char* template1 = getFixedQwen3Template();
  const char* template2 = getFixedQwen3Template();
  const char* template3 = getFixedQwen3Template();

  EXPECT_EQ(template1, template2);
  EXPECT_EQ(template2, template3);
  EXPECT_EQ(std::string(template1), std::string(template2));
  EXPECT_EQ(std::string(template2), std::string(template3));
}

TEST_F(QwenTemplateTest, ContainsMessageRoleHandling) {
  const char* template_str = getFixedQwen3Template();
  std::string template_string(template_str);

  EXPECT_NE(template_string.find("message.role"), std::string::npos);
  EXPECT_NE(template_string.find("user"), std::string::npos);
  EXPECT_NE(template_string.find("assistant"), std::string::npos);
  EXPECT_NE(template_string.find("system"), std::string::npos);
}

// Renders the fixed Qwen3 template through llama.cpp's jinja engine so we can
// assert on the actual prompt that gets tokenized into the KV cache.
class QwenTemplateRenderTest : public ::testing::Test {
protected:
  common_chat_templates_ptr tmpls_;

  void SetUp() override {
    const char* tmpl = getFixedQwen3Template();
    tmpls_ = common_chat_templates_init(nullptr, tmpl);
  }

  common_chat_templates_inputs makeInputs(
      std::vector<common_chat_msg> messages,
      bool addGenerationPrompt = true) {
    common_chat_templates_inputs inputs;
    inputs.use_jinja = true;
    inputs.add_generation_prompt = addGenerationPrompt;
    inputs.messages = std::move(messages);
    return inputs;
  }

  std::string render(common_chat_templates_inputs& inputs) {
    return common_chat_templates_apply(tmpls_.get(), inputs).prompt;
  }

  static common_chat_msg
  msg(const std::string& role, const std::string& content) {
    common_chat_msg m;
    m.role = role;
    m.content = content;
    return m;
  }
};

// Reasoning produced in the CURRENT round (assistant turns after the last user
// message) is expected to remain in the prompt - the model needs it in-context.
TEST_F(QwenTemplateRenderTest, CurrentTurnReasoningIsKept) {
  auto inputs = makeInputs(
      {msg("user", "Question"),
       msg("assistant",
           "<think>current round reasoning</think>\n\nThe answer.")});

  std::string prompt = render(inputs);

  EXPECT_NE(prompt.find("current round reasoning"), std::string::npos)
      << "current-turn reasoning should be preserved";
}

// Reasoning from PRIOR turns (before the last user message) should be stripped,
// matching upstream Qwen3's rolling-checkpoint behavior and the tools-compact
// template. If it is re-injected, stale thinking ends up tokenized into the KV
// cache on every subsequent turn.
//
// This test currently FAILS: the fixed template computes `last_query_index` but
// never uses it, so historical `<think>` blocks are added back into the prompt.
TEST_F(QwenTemplateRenderTest, HistoricalReasoningIsStripped) {
  auto inputs = makeInputs(
      {msg("user", "First question"),
       msg("assistant",
           "<think>secret historical reasoning</think>\n\nFirst answer."),
       msg("user", "Second question")});

  std::string prompt = render(inputs);

  EXPECT_NE(prompt.find("First answer."), std::string::npos)
      << "historical assistant answer should be preserved";
  EXPECT_EQ(prompt.find("secret historical reasoning"), std::string::npos)
      << "historical reasoning should be stripped, not re-injected into the "
         "prompt/KV cache";
}
