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

void BreakseqProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();

    if (auto* head = getPlayHead())
        if (auto position = head->getPosition())
            if (auto hostBpm = position->getBpm())
                bpm.store (*hostBpm);

    const auto rate = getSampleRate() > 0.0 ? getSampleRate() : 44100.0;
    sampler.process (buffer, midi, rate);
    mixer.process (buffer, rate);
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

namespace
{
    /** 1: the project. 2: also the frozen pieces and the bar's drag fields, and the .breakseq file. */
    constexpr int stateVersion = 2;
    const char* const fieldNames[] { "audio", "midi", "space", "rex", "rexMidi" };
}

void BreakseqProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::ValueTree state ("Breakseq");
    state.setProperty ("version", stateVersion, nullptr);
    state.setProperty ("project", getProject(), nullptr);

    if (projectFile != juce::File())
        state.setProperty ("projectFile", projectFile.getFullPathName(), nullptr);

    if (const auto pieces = sampler.getPieces())
        state.setProperty ("pieces", Sampler::write (*pieces), nullptr);

    for (size_t i = 0; i < Clips::fields; ++i)
    {
        const auto field = clips.get (i);

        if (field.file == juce::File())
            continue;

        juce::ValueTree clip ("Clip");
        clip.setProperty ("field", fieldNames[i], nullptr);
        clip.setProperty ("path", field.file.getFullPathName(), nullptr);
        clip.setProperty ("label", field.label, nullptr);
        state.appendChild (clip, nullptr);
    }

    juce::MemoryOutputStream out (destData, false);
    state.writeToStream (out);
}

void BreakseqProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    const auto state = juce::ValueTree::readFromData (data, (size_t) sizeInBytes);

    if (! state.hasType ("Breakseq"))
        return;

    setProject (state.getProperty ("project", "").toString());

    const auto file = state.getProperty ("projectFile", "").toString();
    projectFile = file.isEmpty() ? juce::File() : juce::File (file);

    // Version 1 (phase 1) has no pieces and no fields: as a new instance there.
    if (const auto* bytes = state.getProperty ("pieces").getBinaryData())
        sampler.setPieces (Sampler::read (*bytes));
    else
        sampler.setPieces (nullptr);

    for (size_t i = 0; i < Clips::fields; ++i)
        clips.restore (i, {});

    for (const auto& clip : state)
        for (size_t i = 0; i < Clips::fields; ++i)
            if (clip.hasType ("Clip") && clip.getProperty ("field").toString() == fieldNames[i])
                clips.restore (i, { juce::File (clip.getProperty ("path").toString()), clip.getProperty ("label").toString() });
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new BreakseqProcessor();
}
