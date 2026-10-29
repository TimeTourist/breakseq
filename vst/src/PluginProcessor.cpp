#include "PluginProcessor.h"
#include "PluginEditor.h"

BreakseqProcessor::BreakseqProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

void BreakseqProcessor::prepareToPlay (double, int)
{
}

bool BreakseqProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

void BreakseqProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();

    if (auto* head = getPlayHead())
        if (auto position = head->getPosition())
            if (auto hostBpm = position->getBpm())
                bpm.store (*hostBpm);

    mixer.process (buffer, getSampleRate() > 0.0 ? getSampleRate() : 44100.0);
}

juce::String BreakseqProcessor::getProject() const
{
    const juce::ScopedLock lock (projectLock);
    return project;
}

void BreakseqProcessor::setProject (const juce::String& base64)
{
    const juce::ScopedLock lock (projectLock);
    project = base64;
}

juce::AudioProcessorEditor* BreakseqProcessor::createEditor()
{
    return new BreakseqEditor (*this);
}

void BreakseqProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::ValueTree state ("Breakseq");
    state.setProperty ("version", 1, nullptr);
    state.setProperty ("project", getProject(), nullptr);

    juce::MemoryOutputStream out (destData, false);
    state.writeToStream (out);
}

void BreakseqProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    const auto state = juce::ValueTree::readFromData (data, (size_t) sizeInBytes);

    if (state.hasType ("Breakseq"))
        setProject (state.getProperty ("project", "").toString());
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new BreakseqProcessor();
}
